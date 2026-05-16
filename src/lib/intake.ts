import { randomUUID } from "node:crypto";
import { logger } from "@trigger.dev/sdk/v3";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db";
import {
	artifactChunks,
	certificates,
	evidencePackages,
	packageEntities,
	sourceArtifacts,
	sourceIntakeLinks,
	verificationRuns,
} from "../db/schema";
import {
	type DocumentSummaryOutput,
	genericPartialSummary,
	summarizeArtifactWithPseudonyms,
} from "../mastra/verification/document-summary";
import { fallbackCertificatePayload } from "../mastra/verification/fallback";
import {
	METHODOLOGY_VERSION,
	methodologyHash,
} from "../mastra/verification/methodology";
import {
	buildDictionary,
	loadPackageEntities,
	type MergeLogEntry,
	type PseudonymDictionary,
	sweepPublicStrings,
} from "../mastra/verification/pseudonyms";
import {
	type CertificatePayload,
	sanitizeExternalSources,
} from "../mastra/verification/schemas";
import { stampManifest } from "./anchor";
import { gatherPerFactCorroboration } from "./corroboration";
import { chunkText, embedChunks, extractArtifactText } from "./extraction";
import {
	createPresignedPutUrl,
	deleteEvidenceObjects,
	headEvidenceObject,
	readEvidenceObject,
} from "./s3";
import { createCapabilityToken, hashToken, publicId, sha256 } from "./security";

type CertificatePayloadWithHash = CertificatePayload & {
	methodologyHash: string;
};
type FallbackPayloadInput = Parameters<typeof fallbackCertificatePayload>[0];
type StepState = { status?: string; label?: string };

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type SourceArtifactRow = typeof sourceArtifacts.$inferSelect;

type ProcessedArtifact = {
	artifact: SourceArtifactRow;
	digest: string;
	extractedText: string;
	byteLength: number;
	summary?: DocumentSummaryOutput;
	summaryStatus: "complete" | "partial";
	extractionOk: boolean;
	extractionFailure?: { reason: string; detail: string };
};

function artifactLabel(index: number, filename: string) {
	const extension = filename.includes(".")
		? filename.split(".").pop()?.toUpperCase()
		: "FILE";
	return `Artifact ${alphabet[index] ?? index + 1}: ${extension?.toLowerCase()} upload`;
}

function sanitizeFilename(filename: string) {
	return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function sourcePseudonym() {
	return `Source ${alphabet[Math.floor(Math.random() * alphabet.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function formatDictionaryForReview(dict: PseudonymDictionary) {
	if (dict.length === 0) {
		return "(no entities resolved)";
	}
	return dict
		.map(
			(entry) =>
				`${entry.pseudonym}: ${entry.realName}${entry.variants.length ? `; variants: ${entry.variants.join(", ")}` : ""}`,
		)
		.join("\n");
}

function formatMergeLogForReview(mergeLog: MergeLogEntry[]) {
	if (mergeLog.length === 0) {
		return "(no entity merge decisions recorded)";
	}
	return mergeLog
		.map(
			(entry) =>
				`${entry.action.toUpperCase()} ${entry.kind} "${entry.canonical}" -> ${entry.pseudonym} (${entry.mergeConfidence})${
					entry.mergeNotes ? `: ${entry.mergeNotes}` : ""
				}`,
		)
		.join("\n");
}

function formatSummaryForArtifact(
	artifact: ProcessedArtifact,
	dict: PseudonymDictionary,
) {
	const summary = artifact.summary;
	const signals = summary?.signals.length
		? summary.signals.map((signal) => `  - ${signal}`).join("\n")
		: "  - (none)";
	const limitations = summary?.limitations.length
		? summary.limitations.map((limitation) => `  - ${limitation}`).join("\n")
		: "  - (none)";
	return [
		artifact.artifact.sanitizedLabel,
		`sha256: ${artifact.digest}`,
		`mimeType: ${artifact.artifact.mimeType}`,
		"Public-safe document summary:",
		`  status: ${artifact.summaryStatus}`,
		`  role: ${summary?.role ?? ""}`,
		`  synopsis: ${summary?.publicSafeSynopsis ?? ""}`,
		"  signals:",
		signals,
		"  limitations:",
		limitations,
		"Pseudonym dictionary for public certificate references:",
		formatDictionaryForReview(dict),
		"Private extracted text excerpt (real names retained for reviewer reasoning):",
		artifact.extractedText.slice(0, 6000),
	].join("\n");
}

function initialStepStates(): Record<string, StepState> {
	return {
		intake: { status: "complete", label: "Evidence received and queued" },
		extraction: {
			status: "pending",
			label: "Waiting to extract uploaded files",
		},
		summaries: { status: "pending", label: "Waiting to summarize artifacts" },
		embeddings: { status: "pending", label: "Waiting to embed private chunks" },
		external: {
			status: "pending",
			label: "Waiting to gather public corroboration",
		},
		internal: {
			status: "pending",
			label: "Waiting for internal consistency review",
		},
		redTeam: { status: "pending", label: "Waiting for adversarial review" },
		scoring: { status: "pending", label: "Waiting to score certificate" },
	};
}

function stepStatesForPayload(
	payload: CertificatePayloadWithHash,
	metadata: Record<string, unknown> = {},
) {
	const factCount =
		typeof metadata.corroborationFactCount === "number"
			? metadata.corroborationFactCount
			: 0;
	const sourceCount =
		typeof metadata.corroborationSourceCount === "number"
			? metadata.corroborationSourceCount
			: 0;
	return {
		intake: { status: "complete", label: "Evidence manifest anchored locally" },
		extraction: { status: "complete", label: "Uploaded files extracted" },
		summaries: {
			status: "complete",
			label: "Public-safe artifact summaries prepared",
		},
		embeddings: {
			status: "complete",
			label: "Private artifact chunks embedded",
		},
		internal: { status: "complete", label: payload.findings.internal.summary },
		external: {
			status: "complete",
			label: `${payload.findings.external.summary} (${factCount} facts, ${sourceCount} sources)`,
		},
		redTeam: { status: "complete", label: payload.findings.redTeam.summary },
		scoring: { status: "complete", label: `Tier assigned: ${payload.tier}` },
	};
}

async function updateRunStatus(
	runId: string,
	status: string,
	extra: Partial<typeof verificationRuns.$inferInsert> = {},
) {
	await db
		.update(verificationRuns)
		.set({ status, ...extra })
		.where(eq(verificationRuns.id, runId));
}

async function updateRunStep(runId: string, key: string, state: StepState) {
	const run = await getRun(runId);
	const stepStates = {
		...((run?.stepStates as Record<string, StepState> | undefined) ?? {}),
		[key]: state,
	};
	await db
		.update(verificationRuns)
		.set({ stepStates })
		.where(eq(verificationRuns.id, runId));
}

export async function markRunFailed(runId: string, error: unknown) {
	const message =
		error instanceof Error
			? error.message
			: "Unknown intake processing failure.";
	const run = await getRun(runId);
	const stepStates = {
		...((run?.stepStates as Record<string, StepState> | undefined) ?? {}),
		scoring: { status: "failed", label: message },
	};
	await db
		.update(verificationRuns)
		.set({
			status: "failed",
			completedAt: new Date(),
			stepStates,
			rawFindingsJson: {
				...((run?.rawFindingsJson as Record<string, unknown> | null) ?? {}),
				error: message,
			},
		})
		.where(eq(verificationRuns.id, runId));
}

async function createQueuedRun(packageId: string) {
	const [run] = await db
		.insert(verificationRuns)
		.values({
			packageId,
			methodologyVersion: METHODOLOGY_VERSION,
			methodologyHash: methodologyHash(),
			status: "queued",
			startedAt: new Date(),
			stepStates: initialStepStates(),
		})
		.returning();

	return run;
}

function sanitizePayloadExternalSources<T extends CertificatePayloadWithHash>(
	payload: T,
): T {
	return {
		...payload,
		externalChecks: payload.externalChecks.map((check) => ({
			...check,
			sources: sanitizeExternalSources(check.sources),
		})),
		findings: {
			...payload.findings,
			external: {
				...payload.findings.external,
				entityFindings: payload.findings.external.entityFindings.map(
					(finding) => ({
						...finding,
						sources: sanitizeExternalSources(finding.sources),
					}),
				),
				publicFacts: payload.findings.external.publicFacts.map((fact) => ({
					...fact,
					sources: sanitizeExternalSources(fact.sources),
				})),
			},
		},
	};
}

async function persistCertificatePayload(
	packageId: string,
	payload: CertificatePayloadWithHash,
	metadata: Record<string, unknown> = {},
	runId?: string,
) {
	const certificateId = publicId("cert");
	const payloadToPersist = sanitizePayloadExternalSources(payload);
	const runValues = {
		packageId,
		methodologyVersion: METHODOLOGY_VERSION,
		methodologyHash: payloadToPersist.methodologyHash,
		rawFindingsJson: { ...payloadToPersist, certificateId, ...metadata },
		status: "complete",
		completedAt: new Date(),
		stepStates: stepStatesForPayload(payloadToPersist, metadata),
	};
	const [run] = runId
		? await db
				.update(verificationRuns)
				.set(runValues)
				.where(eq(verificationRuns.id, runId))
				.returning()
		: await db
				.insert(verificationRuns)
				.values({ ...runValues, startedAt: new Date() })
				.returning();

	await db.insert(certificates).values({
		publicId: certificateId,
		packageId,
		runId: run.id,
		tier: payloadToPersist.tier,
		evidenceBreakdown: payloadToPersist,
		concerns: payloadToPersist.concerns,
		attributionSnippets: payloadToPersist.attributionSnippets,
		methodologyHash: payloadToPersist.methodologyHash,
	});

	return { runId: run.id, certificateId };
}

function mergeWorkflowPayload(
	basePayload: CertificatePayloadWithHash,
	workflowPayload: CertificatePayload,
): CertificatePayloadWithHash {
	return {
		...basePayload,
		tier: workflowPayload.tier,
		confidenceScore: workflowPayload.confidenceScore,
		tierDefinition: workflowPayload.tierDefinition,
		verifiedSummary: workflowPayload.verifiedSummary,
		checkedItems: workflowPayload.checkedItems,
		provenanceLedger: workflowPayload.provenanceLedger,
		artifactSummaries: workflowPayload.artifactSummaries,
		claimMatrix: workflowPayload.claimMatrix,
		timeline: workflowPayload.timeline,
		externalChecks: workflowPayload.externalChecks.length
			? workflowPayload.externalChecks
			: basePayload.externalChecks,
		concerns: workflowPayload.concerns,
		attributionSnippets: workflowPayload.attributionSnippets,
		privacyRedactions: workflowPayload.privacyRedactions,
		limitations: workflowPayload.limitations,
		findings: workflowPayload.findings,
	};
}

async function runMastraVerification(
	packageId: string,
	input: FallbackPayloadInput & {
		artifactContext: string;
		mergeLog?: MergeLogEntry[];
	},
	runId?: string,
) {
	if (runId) {
		await updateRunStep(runId, "external", {
			status: "running",
			label: "Extracting public-checkable facts and searching public sources",
		});
	}
	const corroboration = await gatherPerFactCorroboration(input.artifactContext);
	const seededExternalFacts = corroboration.facts.map((fact) => ({
		id: fact.id,
		claim: fact.claim,
		sources: fact.sources,
	}));
	const fallbackPayload = fallbackCertificatePayload({
		...input,
		seededExternalFacts,
	});
	const fallbackDictionary = buildDictionary(
		await loadPackageEntities(packageId),
	);
	const sweptFallback = sweepPublicStrings(fallbackPayload, fallbackDictionary);
	if (sweptFallback.residualMatches.length > 0) {
		logger.warn(
			"Fallback certificate pseudonym sweep caught real entity strings",
			{
				packageId,
				matches: sweptFallback.residualMatches,
			},
		);
	}
	const corroborationMetadata = {
		corroborationStatus: corroboration.status,
		corroborationFactCount: corroboration.facts.length,
		corroborationSourceCount: corroboration.allSources.length,
		...(corroboration.failureReason
			? { corroborationFailureReason: corroboration.failureReason }
			: {}),
	};
	if (runId) {
		await updateRunStep(runId, "external", {
			status: corroboration.status === "degraded" ? "degraded" : "running",
			label:
				corroboration.status === "degraded"
					? `Public corroboration degraded: ${corroboration.failureReason}`
					: `Found ${corroboration.facts.length} public-checkable facts and ${corroboration.allSources.length} sources`,
		});
	}

	try {
		const { mastra } = await import("../mastra");
		const workflow = mastra.getWorkflow("verificationWorkflow");
		const run = await workflow.createRun({ resourceId: packageId });
		const result = await run.start({
			inputData: {
				packageId,
				artifactContext: input.artifactContext,
				externalFacts: seededExternalFacts,
				mergeLog: formatMergeLogForReview(input.mergeLog ?? []),
				manifestHash: input.manifestHash,
				intakeTimestamp: input.intakeTimestamp,
				finalizedAt: input.finalizedAt,
				anchorStatus: input.anchorStatus,
				anchorProof: input.anchorProof ?? null,
			},
			tracingOptions: {
				metadata: { packageId, workflow: "verification-workflow" },
				tags: ["verification", "source-intake"],
			},
		});

		await mastra.observability.getSelectedInstance({})?.flush();

		if (result.status !== "success") {
			if (runId) {
				await updateRunStep(runId, "external", {
					status: "degraded",
					label: `Workflow returned ${result.status}; fallback external findings used`,
				});
			}
			return {
				payload: sweptFallback.value,
				metadata: {
					mastraWorkflowStatus: result.status,
					mastraTraceId: result.traceId,
					...corroborationMetadata,
				},
			};
		}

		const workflowPayload = result.result as CertificatePayload;
		if (runId) {
			await updateRunStep(runId, "internal", {
				status: workflowPayload.findings.internal.status,
				label: workflowPayload.findings.internal.summary,
			});
			await updateRunStep(runId, "external", {
				status: workflowPayload.findings.external.status,
				label: `${workflowPayload.findings.external.summary} (${corroboration.facts.length} facts, ${corroboration.allSources.length} sources)`,
			});
			await updateRunStep(runId, "redTeam", {
				status: workflowPayload.findings.redTeam.status,
				label: workflowPayload.findings.redTeam.summary,
			});
		}
		return {
			payload: mergeWorkflowPayload(sweptFallback.value, workflowPayload),
			metadata: {
				mastraWorkflowStatus: result.status,
				mastraTraceId: result.traceId,
				...corroborationMetadata,
			},
		};
	} catch (error) {
		if (runId) {
			await updateRunStep(runId, "external", {
				status: "degraded",
				label: `Reviewer workflow failed; fallback findings used (${error instanceof Error ? error.message : "unknown error"})`,
			});
		}
		return {
			payload: sweptFallback.value,
			metadata: {
				mastraWorkflowStatus: "fallback",
				mastraWorkflowError:
					error instanceof Error
						? error.message
						: "Unknown Mastra workflow error",
				...corroborationMetadata,
			},
		};
	}
}

export async function createSourceIntakeLink(input: { caseMemo?: string }) {
	const token = createCapabilityToken();
	const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

	const [row] = await db
		.insert(sourceIntakeLinks)
		.values({
			tokenHash: hashToken(token),
			caseMemo: input.caseMemo || null,
			expiresAt,
		})
		.returning();

	return { id: row.id, token, expiresAt: expiresAt.toISOString() };
}

export async function getSourceLink(token: string) {
	const [row] = await db
		.select()
		.from(sourceIntakeLinks)
		.where(
			and(
				eq(sourceIntakeLinks.tokenHash, hashToken(token)),
				eq(sourceIntakeLinks.status, "active"),
				gt(sourceIntakeLinks.expiresAt, new Date()),
			),
		)
		.limit(1);

	return row;
}

async function ensurePackageForLink(token: string) {
	const link = await getSourceLink(token);
	if (!link) {
		throw new Error("This intake link is invalid, expired, or already used.");
	}

	if (link.packageId) {
		return { link, packageId: link.packageId };
	}

	const [pkg] = await db
		.insert(evidencePackages)
		.values({
			pseudonym: sourcePseudonym(),
			anchorStatus: "pending",
			fileRefs: [],
		})
		.returning();

	await db
		.update(sourceIntakeLinks)
		.set({ packageId: pkg.id })
		.where(eq(sourceIntakeLinks.id, link.id));

	return { link: { ...link, packageId: pkg.id }, packageId: pkg.id };
}

export async function createUploadSlots(input: {
	token: string;
	files: Array<{ filename: string; contentType: string; sizeBytes: number }>;
}) {
	const { packageId } = await ensurePackageForLink(input.token);
	const [pkg] = await db
		.select({ summarizationSealedAt: evidencePackages.summarizationSealedAt })
		.from(evidencePackages)
		.where(eq(evidencePackages.id, packageId))
		.limit(1);

	if (pkg?.summarizationSealedAt) {
		throw new Error(
			"This evidence package has already been summarized and sealed; additional uploads are not allowed.",
		);
	}

	const slots = [];

	for (const [index, file] of input.files.entries()) {
		const artifactId = randomUUID();
		const label = artifactLabel(index, file.filename);
		const key = `packages/${packageId}/${artifactId}/${sanitizeFilename(file.filename)}`;
		const url = await createPresignedPutUrl({
			key,
			contentType: file.contentType || "application/octet-stream",
			contentLength: file.sizeBytes,
		});

		await db.insert(sourceArtifacts).values({
			id: artifactId,
			packageId,
			originalFilename: file.filename,
			sanitizedLabel: label,
			mimeType: file.contentType || "application/octet-stream",
			sizeBytes: file.sizeBytes,
			s3ObjectKey: key,
			extractionStatus: "pending",
		});

		slots.push({ artifactId, label, key, url });
	}

	return { packageId, slots };
}

export async function finalizeIntake(token: string) {
	const link = await getSourceLink(token);
	if (!link?.packageId) {
		throw new Error("No uploaded package is associated with this intake link.");
	}
	const packageId = link.packageId;

	const [pkg] = await db
		.select({
			summarizationSealedAt: evidencePackages.summarizationSealedAt,
			pseudonym: evidencePackages.pseudonym,
		})
		.from(evidencePackages)
		.where(eq(evidencePackages.id, packageId))
		.limit(1);

	if (pkg?.summarizationSealedAt) {
		throw new Error(
			"This evidence package has already been summarized and sealed.",
		);
	}

	const artifacts = await db
		.select()
		.from(sourceArtifacts)
		.where(eq(sourceArtifacts.packageId, packageId))
		.orderBy(asc(sourceArtifacts.createdAt), asc(sourceArtifacts.id));

	if (artifacts.length === 0) {
		throw new Error("No artifacts were registered for this intake link.");
	}

	await Promise.all(
		artifacts.map(async (artifact) => {
			const head = await headEvidenceObject(artifact.s3ObjectKey);
			if (
				typeof head.ContentLength === "number" &&
				head.ContentLength !== artifact.sizeBytes
			) {
				logger.warn("S3 object size differs from declared upload size", {
					artifactId: artifact.id,
					s3ObjectKey: artifact.s3ObjectKey,
					declaredSize: artifact.sizeBytes,
					s3ContentLength: head.ContentLength,
				});
			}
		}),
	);

	const preliminaryRefs = artifacts.map((artifact) => ({
		artifactId: artifact.id,
		label: artifact.sanitizedLabel,
		mimeType: artifact.mimeType,
		sizeBytes: artifact.sizeBytes,
	}));
	const run = await createQueuedRun(packageId);

	await db
		.update(evidencePackages)
		.set({
			fileRefs: preliminaryRefs,
			anchorStatus: "pending",
		})
		.where(eq(evidencePackages.id, packageId));

	await db
		.update(sourceIntakeLinks)
		.set({ status: "used", usedAt: new Date() })
		.where(eq(sourceIntakeLinks.id, link.id));

	const { tasks } = await import("@trigger.dev/sdk/v3");
	await tasks.trigger<
		typeof import("../trigger/processIntake").processIntakeTask
	>("process-intake", { packageId, runId: run.id });

	return {
		packageId,
		pseudonym: pkg?.pseudonym ?? "Unknown source",
		runId: run.id,
	};
}

export async function processIntakePackage(packageId: string, runId: string) {
	await updateRunStatus(runId, "running");
	await updateRunStep(runId, "extraction", {
		status: "running",
		label: "Extracting uploaded files and hashing artifacts",
	});

	const artifacts = await db
		.select()
		.from(sourceArtifacts)
		.where(eq(sourceArtifacts.packageId, packageId))
		.orderBy(asc(sourceArtifacts.createdAt), asc(sourceArtifacts.id));

	if (artifacts.length === 0) {
		throw new Error("No artifacts were registered for this evidence package.");
	}

	const manifestFiles = [];
	const processedArtifacts: ProcessedArtifact[] = [];

	for (const artifact of artifacts) {
		const head = await headEvidenceObject(artifact.s3ObjectKey);
		const bytes = await readEvidenceObject(artifact.s3ObjectKey);
		const digest = sha256(bytes);
		const extraction = await extractArtifactText({
			bytes,
			mimeType: artifact.mimeType,
			filename: artifact.originalFilename,
		});

		if (!extraction.ok) {
			logger.error("Artifact extraction failed", {
				packageId,
				artifactId: artifact.id,
				filename: artifact.originalFilename,
				mimeType: artifact.mimeType,
				s3ContentLength: bytes.length,
				s3HeadContentLength: head.ContentLength ?? null,
				declaredSize: artifact.sizeBytes,
				reason: extraction.reason,
				detail: extraction.detail,
			});
		}

		const extractedText = extraction.ok ? extraction.text : "";

		await db
			.update(sourceArtifacts)
			.set({
				sha256: digest,
				rawExtractedText: extractedText,
				extractionStatus: extraction.ok ? "complete" : "failed",
				summaryStatus: extraction.ok ? "pending" : "partial",
				metadataJson: {
					extractedAt: new Date().toISOString(),
					...(extraction.ok
						? {}
						: {
								extractionFailure: {
									reason: extraction.reason,
									detail: extraction.detail,
								},
							}),
				},
			})
			.where(eq(sourceArtifacts.id, artifact.id));

		if (extraction.ok) {
			const chunks = chunkText(extractedText);
			const embeddings = await embedChunks(chunks);

			for (const [chunkIndex, content] of chunks.entries()) {
				const embedding = embeddings[chunkIndex];
				await db.insert(artifactChunks).values({
					artifactId: artifact.id,
					chunkIndex,
					content,
					contentHash: sha256(content),
					embedding: embedding && embedding.length > 0 ? embedding : undefined,
					embedded: Boolean(embedding?.length),
					metadataJson: { label: artifact.sanitizedLabel },
				});
			}
		}

		processedArtifacts.push({
			artifact,
			digest,
			extractedText,
			byteLength: bytes.length,
			summaryStatus: "partial",
			extractionOk: extraction.ok,
			extractionFailure: extraction.ok
				? undefined
				: { reason: extraction.reason, detail: extraction.detail },
		});

		manifestFiles.push({
			artifactId: artifact.id,
			label: artifact.sanitizedLabel,
			mimeType: artifact.mimeType,
			sizeBytes: bytes.length,
			sha256: digest,
		});
	}

	await updateRunStep(runId, "extraction", {
		status: "complete",
		label: `${processedArtifacts.length} uploaded files extracted and hashed`,
	});
	await updateRunStep(runId, "embeddings", {
		status: "complete",
		label: "Private artifact chunks embedded",
	});
	await updateRunStep(runId, "summaries", {
		status: "running",
		label: "Preparing public-safe artifact summaries",
	});

	const mergeLog: MergeLogEntry[] = [];

	for (const processed of processedArtifacts) {
		if (!processed.extractionOk) {
			const failure = processed.extractionFailure!;
			const fallback = genericPartialSummary({
				label: processed.artifact.sanitizedLabel,
				mimeType: processed.artifact.mimeType,
				error: `${failure.reason}: ${failure.detail}`,
			});
			processed.summary = fallback;
			processed.summaryStatus = "partial";
			await db
				.update(sourceArtifacts)
				.set({
					role: fallback.role,
					processingSummary: fallback.processingSummary,
					publicSafeSynopsis: fallback.publicSafeSynopsis,
					signals: fallback.signals,
					limitations: fallback.limitations,
					publicExcerpts: fallback.excerpts,
					summaryStatus: "partial",
				})
				.where(eq(sourceArtifacts.id, processed.artifact.id));
			continue;
		}

		const summaryResult = await summarizeArtifactWithPseudonyms({
			packageId,
			artifactId: processed.artifact.id,
			label: processed.artifact.sanitizedLabel,
			mimeType: processed.artifact.mimeType,
			sizeBytes: processed.byteLength,
			extractedText: processed.extractedText,
		});

		mergeLog.push(...summaryResult.mergeLog);

		if (summaryResult.ok) {
			processed.summary = summaryResult.data;
			processed.summaryStatus = summaryResult.summaryStatus;
			await db
				.update(sourceArtifacts)
				.set({
					role: summaryResult.data.role,
					processingSummary: summaryResult.data.processingSummary,
					publicSafeSynopsis: summaryResult.data.publicSafeSynopsis,
					signals: summaryResult.data.signals,
					limitations: summaryResult.data.limitations,
					publicExcerpts: summaryResult.data.excerpts,
					summaryStatus: summaryResult.summaryStatus,
				})
				.where(eq(sourceArtifacts.id, processed.artifact.id));
			continue;
		}

		processed.summaryStatus = "partial";
		logger.error("Artifact summarization failed", {
			packageId,
			artifactId: processed.artifact.id,
			error: summaryResult.error,
		});
		await db
			.update(sourceArtifacts)
			.set({
				role: null,
				processingSummary: null,
				publicSafeSynopsis: null,
				signals: [],
				limitations: [],
				publicExcerpts: [],
				summaryStatus: "partial",
			})
			.where(eq(sourceArtifacts.id, processed.artifact.id));
	}

	await updateRunStep(runId, "summaries", {
		status: "complete",
		label: "Public-safe artifact summaries prepared",
	});

	const packageEntityRows = await loadPackageEntities(packageId);
	const dictionary = buildDictionary(packageEntityRows);
	const publicManifestFiles = processedArtifacts.map((processed) => ({
		artifactId: processed.artifact.id,
		label: processed.artifact.sanitizedLabel,
		mimeType: processed.artifact.mimeType,
		sizeBytes: processed.byteLength,
		sha256: processed.digest,
		role: processed.summary?.role ?? null,
		processingSummary: processed.summary?.processingSummary ?? null,
		publicSafeSynopsis: processed.summary?.publicSafeSynopsis ?? null,
		signals: processed.summary?.signals ?? [],
		limitations: processed.summary?.limitations ?? [],
		excerpts: processed.summary?.excerpts ?? [],
		summaryStatus: processed.summaryStatus,
	}));
	const artifactContext = processedArtifacts
		.map((artifact) => formatSummaryForArtifact(artifact, dictionary))
		.join("\n\n---\n\n");

	const manifest = {
		packageId,
		intakeTs: new Date().toISOString(),
		methodologyHash: methodologyHash(),
		files: manifestFiles,
	};

	const manifestDigest = sha256(JSON.stringify(manifest));
	const anchor = await stampManifest(manifestDigest);

	const [updatedPackage] = await db
		.update(evidencePackages)
		.set({
			manifestHash: manifestDigest,
			anchorStatus: anchor.status,
			anchorProof: anchor.proof,
			fileRefs: manifestFiles,
			summarizationSealedAt: new Date(),
		})
		.where(eq(evidencePackages.id, packageId))
		.returning({ pseudonym: evidencePackages.pseudonym });

	const workflowResult = await runMastraVerification(
		packageId,
		{
			manifestFiles: publicManifestFiles,
			intakeTimestamp: manifest.intakeTs,
			finalizedAt: new Date().toISOString(),
			manifestHash: manifestDigest,
			anchorStatus: anchor.status,
			anchorProof: anchor.proof,
			artifactContext,
			mergeLog,
		},
		runId,
	);
	await updateRunStep(runId, "scoring", {
		status: "running",
		label: "Scoring findings and preparing truth certificate",
	});
	const result = await persistCertificatePayload(
		packageId,
		workflowResult.payload,
		workflowResult.metadata,
		runId,
	);

	return {
		packageId,
		pseudonym: updatedPackage.pseudonym,
		...result,
	};
}

export async function createFallbackRun(
	packageId: string,
	input?: Parameters<typeof fallbackCertificatePayload>[0],
) {
	const payload = fallbackCertificatePayload(input);
	return persistCertificatePayload(packageId, payload);
}

export async function getCertificate(publicIdValue: string) {
	const [row] = await db
		.select({
			certificate: certificates,
			package: evidencePackages,
		})
		.from(certificates)
		.innerJoin(
			evidencePackages,
			eq(certificates.packageId, evidencePackages.id),
		)
		.where(eq(certificates.publicId, publicIdValue))
		.limit(1);

	return row;
}

export async function deleteCertificate(publicIdValue: string) {
	const row = await getCertificate(publicIdValue);
	if (!row) {
		throw new Error("Certificate not found.");
	}

	const packageId = row.certificate.packageId;
	const artifacts = await db
		.select({
			id: sourceArtifacts.id,
			s3ObjectKey: sourceArtifacts.s3ObjectKey,
		})
		.from(sourceArtifacts)
		.where(eq(sourceArtifacts.packageId, packageId));
	const artifactIds = artifacts.map((artifact) => artifact.id);
	const s3ObjectKeys = artifacts.map((artifact) => artifact.s3ObjectKey);

	await deleteEvidenceObjects(s3ObjectKeys);

	await db.transaction(async (tx) => {
		if (artifactIds.length > 0) {
			await tx
				.delete(artifactChunks)
				.where(inArray(artifactChunks.artifactId, artifactIds));
		}

		await tx
			.delete(packageEntities)
			.where(eq(packageEntities.packageId, packageId));
		await tx
			.delete(sourceArtifacts)
			.where(eq(sourceArtifacts.packageId, packageId));
		await tx
			.delete(certificates)
			.where(eq(certificates.publicId, publicIdValue));
		await tx
			.delete(verificationRuns)
			.where(eq(verificationRuns.packageId, packageId));
		await tx
			.delete(sourceIntakeLinks)
			.where(eq(sourceIntakeLinks.packageId, packageId));
		await tx.delete(evidencePackages).where(eq(evidencePackages.id, packageId));
	});

	return { publicId: publicIdValue, packageId, deleted: true as const };
}

export async function deleteIntakeLink(linkId: string) {
	const [link] = await db
		.select()
		.from(sourceIntakeLinks)
		.where(eq(sourceIntakeLinks.id, linkId))
		.limit(1);

	if (!link) {
		throw new Error("Intake link not found.");
	}

	const packageId = link.packageId;

	if (packageId) {
		const [cert] = await db
			.select({ publicId: certificates.publicId })
			.from(certificates)
			.where(eq(certificates.packageId, packageId))
			.limit(1);
		if (cert) {
			throw new Error(
				"This channel has already been finalized. Delete it from Truth certificates instead.",
			);
		}
	}

	const artifacts = packageId
		? await db
				.select({
					id: sourceArtifacts.id,
					s3ObjectKey: sourceArtifacts.s3ObjectKey,
				})
				.from(sourceArtifacts)
				.where(eq(sourceArtifacts.packageId, packageId))
		: [];
	const artifactIds = artifacts.map((artifact) => artifact.id);
	const s3ObjectKeys = artifacts.map((artifact) => artifact.s3ObjectKey);

	if (s3ObjectKeys.length > 0) {
		await deleteEvidenceObjects(s3ObjectKeys);
	}

	await db.transaction(async (tx) => {
		if (packageId) {
			if (artifactIds.length > 0) {
				await tx
					.delete(artifactChunks)
					.where(inArray(artifactChunks.artifactId, artifactIds));
			}
			await tx
				.delete(packageEntities)
				.where(eq(packageEntities.packageId, packageId));
			await tx
				.delete(sourceArtifacts)
				.where(eq(sourceArtifacts.packageId, packageId));
			await tx
				.delete(verificationRuns)
				.where(eq(verificationRuns.packageId, packageId));
		}

		await tx.delete(sourceIntakeLinks).where(eq(sourceIntakeLinks.id, linkId));

		if (packageId) {
			await tx
				.delete(evidencePackages)
				.where(eq(evidencePackages.id, packageId));
		}
	});

	return { id: linkId, packageId, deleted: true as const };
}

export async function getRun(runId: string) {
	const [row] = await db
		.select()
		.from(verificationRuns)
		.where(eq(verificationRuns.id, runId))
		.limit(1);

	return row;
}

export type DashboardAwaitingUpload = {
	id: string;
	createdAt: string;
	expiresAt: string;
	caseMemo: string | null;
	status: string;
};

export type DashboardProcessing = {
	packageId: string;
	pseudonym: string;
	intakeTs: string;
	fileCount: number;
	anchorStatus: string;
	runId: string | null;
	runStatus: string | null;
	stepStates: Record<string, { status?: string; label?: string }>;
};

export type DashboardPublished = {
	publicId: string;
	packageId: string;
	runId: string;
	tier: string;
	publishedAt: string;
	pseudonym: string;
	fileCount: number;
	manifestHash: string | null;
};

export type DashboardSnapshot = {
	awaitingUpload: DashboardAwaitingUpload[];
	processing: DashboardProcessing[];
	published: DashboardPublished[];
};

export async function listDashboard(): Promise<DashboardSnapshot> {
	const [linkRows, packageRows, runRows, certRows] = await Promise.all([
		db
			.select()
			.from(sourceIntakeLinks)
			.orderBy(desc(sourceIntakeLinks.createdAt)),
		db.select().from(evidencePackages).orderBy(desc(evidencePackages.intakeTs)),
		db
			.select()
			.from(verificationRuns)
			.orderBy(desc(verificationRuns.createdAt)),
		db.select().from(certificates).orderBy(desc(certificates.publishedAt)),
	]);

	const certByPkg = new Map(certRows.map((cert) => [cert.packageId, cert]));
	const usedPackageIds = new Set(
		linkRows
			.filter((link) => link.packageId && link.status === "used")
			.map((link) => link.packageId as string),
	);
	const latestRunByPkg = new Map<string, (typeof runRows)[number]>();
	for (const run of runRows) {
		if (!latestRunByPkg.has(run.packageId)) {
			latestRunByPkg.set(run.packageId, run);
		}
	}
	const packageById = new Map(packageRows.map((pkg) => [pkg.id, pkg]));

	const now = new Date();
	const awaitingUpload: DashboardAwaitingUpload[] = linkRows
		.filter((link) => link.status === "active" && link.expiresAt > now)
		.map((link) => ({
			id: link.id,
			createdAt: link.createdAt.toISOString(),
			expiresAt: link.expiresAt.toISOString(),
			caseMemo: link.caseMemo ?? null,
			status: link.status,
		}));

	const processing: DashboardProcessing[] = packageRows
		.filter(
			(pkg) =>
				!certByPkg.has(pkg.id) &&
				(usedPackageIds.has(pkg.id) ||
					latestRunByPkg.has(pkg.id) ||
					Boolean(pkg.summarizationSealedAt)),
		)
		.map((pkg) => {
			const run = latestRunByPkg.get(pkg.id);
			const fileRefs = Array.isArray(pkg.fileRefs) ? pkg.fileRefs : [];
			return {
				packageId: pkg.id,
				pseudonym: pkg.pseudonym,
				intakeTs: pkg.intakeTs.toISOString(),
				fileCount: fileRefs.length,
				anchorStatus: pkg.anchorStatus,
				runId: run?.id ?? null,
				runStatus: run?.status ?? null,
				stepStates:
					(run?.stepStates as
						| Record<string, { status?: string; label?: string }>
						| undefined) ?? {},
			};
		});

	const published: DashboardPublished[] = certRows.map((cert) => {
		const pkg = packageById.get(cert.packageId);
		const fileRefs = Array.isArray(pkg?.fileRefs) ? pkg?.fileRefs : [];
		return {
			publicId: cert.publicId,
			packageId: cert.packageId,
			runId: cert.runId,
			tier: cert.tier,
			publishedAt: cert.publishedAt.toISOString(),
			pseudonym: pkg?.pseudonym ?? "Unknown source",
			fileCount: fileRefs?.length ?? 0,
			manifestHash: pkg?.manifestHash ?? null,
		};
	});

	return { awaitingUpload, processing, published };
}
