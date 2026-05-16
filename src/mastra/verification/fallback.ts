import { METHODOLOGY_VERSION, methodologyHash } from "./methodology";
import type {
	ArtifactCitation,
	ArtifactSummary,
	CertificatePayload,
	ClaimMatrixItem,
	ExternalFactInput,
	ProvenanceFile,
	VerificationFindings,
} from "./schemas";
import { sanitizeExternalSources } from "./schemas";
import { scoreVerificationRun, tierDefinition } from "./scoring";

type PublicManifestFile = {
	artifactId: string;
	label: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	role?: string | null;
	processingSummary?: string | null;
	publicSafeSynopsis?: string | null;
	signals?: string[];
	limitations?: string[];
	excerpts?: ArtifactSummary["excerpts"];
	summaryStatus?: string | null;
};

type FallbackPayloadInput = {
	manifestFiles?: PublicManifestFile[];
	intakeTimestamp?: string;
	finalizedAt?: string;
	manifestHash?: string;
	anchorStatus?: string;
	anchorProof?: Record<string, unknown> | null;
	seededExternalFacts?: ExternalFactInput[];
};

type ArtifactProfile = {
	evidenceType: string;
};

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LEGACY_ARTIFACT_SYNOPSIS =
	"This artifact is represented from verified upload metadata and private processing records only. The public truth certificate does not infer its subject matter.";
const LEGACY_ARTIFACT_SIGNALS = new Set([
	"SHA-256 hash and file size are recorded for integrity checking.",
	"Private extraction and chunking status are recorded for reviewer traceability.",
	"Public language is limited to processing facts unless reviewer findings provide content-specific claims.",
]);
const LEGACY_ARTIFACT_LIMITATIONS = new Set([
	"The public truth certificate does not expose raw media, voices, faces, or other identifying content.",
	"The public truth certificate does not expose raw content, original filenames, or source-identifying details.",
	"The public certificate does not expose raw media, voices, faces, or other identifying content.",
	"The public certificate does not expose raw content, original filenames, or source-identifying details.",
	"Metadata alone cannot verify authorship, speaker identity, content meaning, or real-world context.",
]);
const LEGACY_ARTIFACT_EXCERPT_LOCATORS = new Set([
	"metadata-only summary",
	"privacy treatment",
]);
const LEGACY_ARTIFACT_EXCERPT_TEXTS = new Set([
	"The artifact was received and processed; no public-safe content excerpt is available.",
	"Raw artifact content and source-identifying details remain private.",
]);

function evidenceTypeForMime(mimeType: string) {
	const normalized = mimeType.toLowerCase();
	if (normalized.startsWith("audio/")) {
		return "Audio upload";
	}
	if (normalized.startsWith("video/")) {
		return "Video upload";
	}
	if (normalized.startsWith("image/")) {
		return "Image upload";
	}
	if (normalized.includes("pdf")) {
		return "PDF upload";
	}
	if (
		normalized.startsWith("text/") ||
		normalized.includes("json") ||
		normalized.includes("xml")
	) {
		return "Text upload";
	}
	if (normalized.includes("spreadsheet") || normalized.includes("excel")) {
		return "Spreadsheet upload";
	}
	if (
		normalized.includes("presentation") ||
		normalized.includes("powerpoint")
	) {
		return "Presentation upload";
	}
	if (normalized.includes("wordprocessing") || normalized.includes("msword")) {
		return "Document upload";
	}
	return "Binary upload";
}

function profileForMime(mimeType: string): ArtifactProfile {
	const evidenceType = evidenceTypeForMime(mimeType);
	return { evidenceType };
}

function defaultManifestFiles(): PublicManifestFile[] {
	return [
		{ mimeType: "text/plain", sizeBytes: 4096 },
		{ mimeType: "application/pdf", sizeBytes: 4608 },
		{ mimeType: "audio/mpeg", sizeBytes: 5120 },
		{ mimeType: "image/png", sizeBytes: 5632 },
		{ mimeType: "application/octet-stream", sizeBytes: 6144 },
	].map((file, index) => ({
		artifactId: `metadata-artifact-${index + 1}`,
		label: `Artifact ${alphabet[index] ?? index + 1}: ${evidenceTypeForMime(file.mimeType).toLowerCase()}`,
		mimeType: file.mimeType,
		sizeBytes: file.sizeBytes,
		sha256: `${index + 1}`.repeat(64).slice(0, 64),
	}));
}

function buildPublicArtifacts(
	files: PublicManifestFile[],
	input: FallbackPayloadInput,
) {
	const finalizedAt = input.finalizedAt ?? new Date().toISOString();
	const intakeTimestamp = input.intakeTimestamp ?? finalizedAt;

	return files.map((file, index) => {
		const profile = profileForMime(file.mimeType);
		const label = `Artifact ${alphabet[index] ?? index + 1}: ${profile.evidenceType}`;
		const chunkCount = Math.max(1, Math.ceil(file.sizeBytes / 4800));
		const provenance: ProvenanceFile = {
			artifactId: file.artifactId,
			label,
			evidenceType: profile.evidenceType,
			mimeType: file.mimeType,
			sizeBytes: file.sizeBytes,
			sha256: file.sha256,
			hashPreview: `${file.sha256.slice(0, 12)}...${file.sha256.slice(-8)}`,
			extractionStatus: "complete",
			chunkCount,
			contentHashCount: chunkCount,
			embeddedChunkCount: chunkCount,
			manifestIncluded: true,
			uploadedAt: intakeTimestamp,
			finalizedAt,
			privacyTreatment:
				"Original filename, raw content, and source-identifying details withheld.",
		};

		const summary: ArtifactSummary = {
			artifactId: file.artifactId,
			label,
			evidenceType: profile.evidenceType,
			role: file.role ?? "",
			processingSummary: file.processingSummary ?? "",
			publicSafeSynopsis: file.publicSafeSynopsis ?? "",
			extractionStatus:
				file.summaryStatus === "partial"
					? "partial"
					: provenance.extractionStatus,
			metadata: [
				{ label: "MIME type", value: file.mimeType },
				{ label: "Size", value: `${file.sizeBytes.toLocaleString()} bytes` },
				{ label: "SHA-256", value: provenance.hashPreview },
				{
					label: "Chunks",
					value: `${chunkCount} private chunk${chunkCount === 1 ? "" : "s"}`,
				},
			],
			signals: file.signals ?? [],
			limitations: file.limitations ?? [],
			excerpts: file.excerpts ?? [],
		};

		return { citation: citationFromSummary(summary), provenance, summary };
	});
}

function citationFromSummary(
	summary: Pick<ArtifactSummary, "artifactId" | "label" | "excerpts">,
): ArtifactCitation {
	return {
		artifactId: summary.artifactId,
		chunkId: `${summary.artifactId}-public-safe-chunk`,
		label: summary.label,
		locator: summary.excerpts[0]?.locator ?? "provenance ledger",
		snippet: summary.excerpts[0]?.text ?? summary.label,
	};
}

function isLegacyArtifactRole(value: string) {
	return /^Records an? .+ upload in the evidence package without making public claims about its contents\.$/.test(
		value,
	);
}

function isLegacyProcessingSummary(value: string) {
	return value.includes("represented publicly through metadata-only findings");
}

export function isProcessOnlyClaim(claim: string) {
	const normalized = claim.toLowerCase();
	return [
		"sha-256",
		"sha256",
		"hash",
		"manifest",
		"methodology",
		"uploaded artifact",
		"uploaded artifacts",
		"upload metadata",
		"package contains uploaded",
		"raw artifact content",
		"source-identifying",
		"source identifying",
		"withholds",
		"withheld",
		"privacy",
		"extraction",
		"chunk",
		"certificate",
	].some((phrase) => normalized.includes(phrase));
}

export function isProcessOnlyTimelineItem(
	item: CertificatePayload["timeline"][number],
) {
	const normalized = `${item.event} ${item.dateText}`.toLowerCase();
	return [
		"package intake",
		"artifact processing",
		"intake finalization",
		"upload metadata",
		"private processing",
		"processing were recorded",
	].some((phrase) => normalized.includes(phrase));
}

export function normalizeCertificatePayloadForDisplay(
	payload: CertificatePayload,
): CertificatePayload {
	const findings = {
		...payload.findings,
		internal: {
			...payload.findings.internal,
			entityConsistency: normalizeEntityConsistencyForDisplay(
				payload.findings.internal.entityConsistency,
			),
		},
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
	};

	return {
		...payload,
		findings,
		claimMatrix: payload.claimMatrix.filter(
			(claim) => !isProcessOnlyClaim(claim.claim),
		),
		timeline: payload.timeline.filter(
			(item) => !isProcessOnlyTimelineItem(item),
		),
		artifactSummaries: payload.artifactSummaries.map((artifact) => ({
			...artifact,
			role: isLegacyArtifactRole(artifact.role) ? "" : artifact.role,
			processingSummary: isLegacyProcessingSummary(artifact.processingSummary)
				? ""
				: artifact.processingSummary,
			publicSafeSynopsis:
				artifact.publicSafeSynopsis === LEGACY_ARTIFACT_SYNOPSIS
					? ""
					: artifact.publicSafeSynopsis,
			signals: artifact.signals.filter(
				(signal) => !LEGACY_ARTIFACT_SIGNALS.has(signal),
			),
			limitations: artifact.limitations.filter(
				(limitation) => !LEGACY_ARTIFACT_LIMITATIONS.has(limitation),
			),
			excerpts: artifact.excerpts.filter(
				(excerpt) =>
					!LEGACY_ARTIFACT_EXCERPT_LOCATORS.has(excerpt.locator) &&
					!LEGACY_ARTIFACT_EXCERPT_TEXTS.has(excerpt.text),
			),
		})),
		externalChecks: payload.externalChecks.map((check) => ({
			...check,
			sources: sanitizeExternalSources(check.sources),
		})),
	};
}

function dedupeStrings(values: string[]) {
	const seen = new Set<string>();
	return values
		.map((value) => value.trim())
		.filter((value) => {
			const key = value.toLowerCase();
			if (!value || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

export function normalizeEntityConsistencyForDisplay(
	entities: CertificatePayload["findings"]["internal"]["entityConsistency"],
): CertificatePayload["findings"]["internal"]["entityConsistency"] {
	return entities
		.map((entity) => {
			const aliases = dedupeStrings(entity.aliases).filter(
				(alias) => alias.toLowerCase() !== entity.entity.toLowerCase(),
			);
			const summary =
				entity.summary?.trim() ||
				`${entity.entity} appears in the cited evidence with ${entity.consistency} consistency.`;
			return {
				...entity,
				aliases,
				summary,
			};
		})
		.filter(
			(entity) =>
				entity.citations.length > 0 &&
				(entity.summary.trim().length > 0 || entity.aliases.length > 0),
		);
}

export function fallbackFindings(
	packageLabel = "the uploaded evidence package",
	manifestFiles?: PublicManifestFile[],
): VerificationFindings {
	const publicArtifacts = buildPublicArtifacts(
		manifestFiles ?? defaultManifestFiles(),
		{},
	);
	const allCitations = publicArtifacts.map((item) => item.citation);

	return {
		internal: {
			status: "complete",
			summary: `${packageLabel} has recorded upload metadata, integrity hashes, and private processing records.`,
			coreClaims: [],
			contradictions: [],
			timeline: [
				{
					event: "Package intake and artifact processing were recorded.",
					dateText: "recorded during intake finalization",
					citations: allCitations,
					confidence: "high",
				},
			],
			entityConsistency: [],
			limits: [
				"Fallback review does not infer the subject matter of uploaded files.",
			],
		},
		external: {
			status: "complete",
			summary:
				"No external corroboration sources were supplied for this certificate.",
			entityFindings: [],
			publicFacts: [],
			limits: [
				"No public source independently verifies the uploaded materials in this certificate.",
			],
		},
		redTeam: {
			status: "complete",
			summary:
				"Metadata proves receipt and integrity checks, not the truth of any underlying claim.",
			concerns: [
				{
					concern:
						"Metadata alone cannot verify artifact content, authorship, or real-world context.",
					severity: "high",
					tierImpact: "downgrade_signal",
					citations: allCitations,
					publicExplanation:
						"The certificate records upload and processing facts, but content-specific claims require reviewer findings or external corroboration.",
				},
				{
					concern:
						"External timestamp proof is not attached unless an anchor proof is present in the ledger.",
					severity: "medium",
					tierImpact: "downgrade_signal",
					citations: allCitations,
					publicExplanation:
						"The manifest hash records the reviewed package, but an external timestamp would be needed to independently prove when that hash existed.",
				},
			],
			fabricationHypotheses: [
				{
					hypothesis:
						"A file can be hashed after creation regardless of whether its content is accurate.",
					citations: allCitations,
					evidenceThatWouldReduceConcern:
						"Independent source records, external timestamps, or trusted third-party confirmation would reduce this concern.",
				},
				{
					hypothesis:
						"A package can be complete as uploaded while still lacking the context needed to interpret it.",
					citations: allCitations,
					evidenceThatWouldReduceConcern:
						"Content-specific reviewer findings and independently checkable corroboration would reduce this concern.",
				},
			],
			missingChecks: [
				"No content-specific public corroboration was supplied.",
				"No external timestamp anchor is attached to this certificate.",
			],
			sourceIncentiveAssessment:
				"Source incentives are not assessed in the metadata-only certificate.",
		},
	};
}

function confidenceScore(findings: VerificationFindings) {
	let score = 78;
	score -=
		findings.redTeam.concerns.filter((concern) => concern.severity === "high")
			.length * 12;
	score -=
		findings.redTeam.concerns.filter((concern) => concern.severity === "medium")
			.length * 6;
	score -= findings.external.limits.length * 4;
	score += Math.min(8, findings.internal.coreClaims.length * 2);
	return Math.max(0, Math.min(100, score));
}

export function buildClaimMatrix(
	findings: VerificationFindings,
): ClaimMatrixItem[] {
	return findings.internal.coreClaims
		.filter((claim) => !isProcessOnlyClaim(claim.claim))
		.map((claim) => {
			const externallyCheckable =
				findings.external.entityFindings.some((finding) =>
					finding.supportingArtifacts.some(
						(artifact) =>
							artifact.artifactId === claim.supportingArtifacts[0]?.artifactId,
					),
				) ||
				findings.external.publicFacts.some((fact) => {
					if (
						!["verified", "partially_verified"].includes(fact.result) ||
						fact.sources.length === 0
					) {
						return false;
					}
					const citedArtifactIds = new Set(
						claim.supportingArtifacts.map((artifact) => artifact.artifactId),
					);
					if (
						fact.supportingArtifacts.some((artifact) =>
							citedArtifactIds.has(artifact.artifactId),
						)
					) {
						return true;
					}
					const claimText = claim.claim.toLowerCase();
					const factText = fact.claim.toLowerCase();
					return claimText.includes(factText) || factText.includes(claimText);
				});
			const supportLevel =
				claim.contradictingArtifacts.length > 0
					? "contradicted"
					: externallyCheckable
						? "external_context"
						: claim.supportingArtifacts.length > 1
							? "multi_artifact"
							: "single_artifact";

			return {
				claim: claim.claim,
				confidence: claim.confidence,
				supportLevel,
				supportingArtifacts: claim.supportingArtifacts,
				contradictingArtifacts: claim.contradictingArtifacts,
				externallyCheckable,
				publicCorroboration: externallyCheckable
					? "Public sources corroborate this content claim."
					: "No independent public source directly verifies this claim.",
				riskNotes:
					supportLevel === "single_artifact"
						? "This claim is supported by one artifact reference and should be attributed cautiously."
						: "This claim appears across multiple public-safe artifact references, but remains subject to provenance limits.",
			};
		});
}

export function fallbackCertificatePayload(
	input: FallbackPayloadInput = {},
): CertificatePayload & { methodologyHash: string } {
	const manifestFiles = input.manifestFiles?.length
		? input.manifestFiles
		: defaultManifestFiles();
	const publicArtifacts = buildPublicArtifacts(manifestFiles, input);
	const finalizedAt = input.finalizedAt ?? new Date().toISOString();
	const intakeTimestamp = input.intakeTimestamp ?? finalizedAt;
	const manifestHash = input.manifestHash ?? "unavailable";
	const anchorStatus = input.anchorStatus ?? "unavailable";
	const anchorProofType =
		typeof input.anchorProof?.type === "string"
			? input.anchorProof.type
			: "local-sha256-manifest";
	const anchorProofNote =
		typeof input.anchorProof?.note === "string"
			? input.anchorProof.note
			: "External timestamp proof is not attached to this certificate.";
	const findings = fallbackFindings(
		"the uploaded evidence package",
		manifestFiles,
	);
	const tier = scoreVerificationRun(findings);
	const score = confidenceScore(findings);

	return {
		tier,
		confidenceScore: score,
		tierDefinition: tierDefinition(tier),
		verifiedSummary:
			"This certificate records upload integrity, private processing status, and review limitations. It does not infer artifact subject matter without reviewer findings.",
		checkedItems: [
			"Per-artifact SHA-256 hashing and package manifest hashing",
			"Private extraction into content-hashed review chunks where possible",
			"Public-safe provenance fields for each uploaded artifact",
			"Privacy redactions for filenames, raw content, and source-identifying details",
			"Provenance gaps and missing external corroboration",
			"Methodology versioning and public-safe attribution language",
		],
		provenanceLedger: {
			intakeTimestamp,
			finalizedAt,
			manifestHash,
			methodologyHash: methodologyHash(),
			methodologyVersion: METHODOLOGY_VERSION,
			anchorStatus,
			anchorProofType,
			anchorProofNote,
			fileCount: manifestFiles.length,
			totalSizeBytes: manifestFiles.reduce(
				(total, file) => total + file.sizeBytes,
				0,
			),
			files: publicArtifacts.map((item) => item.provenance),
		},
		artifactSummaries: publicArtifacts.map((item) => item.summary),
		claimMatrix: buildClaimMatrix(findings),
		timeline: findings.internal.timeline,
		externalChecks: [
			...findings.external.entityFindings.map((finding) => ({
				label: finding.entity,
				result: finding.verificationStatus,
				whatItCorroborates: finding.notes,
				confidence: finding.confidence,
				sources: finding.sources,
			})),
			...findings.external.publicFacts.map((fact) => ({
				label: fact.claim,
				result: fact.result,
				whatItCorroborates: fact.notes,
				confidence: "medium" as const,
				sources: fact.sources,
			})),
			...(findings.external.publicFacts.length === 0
				? (input.seededExternalFacts ?? []).map((fact) => ({
						label: fact.claim,
						result: "pending" as const,
						whatItCorroborates:
							"Public-web search results gathered for this fact. Reviewer findings will classify the result.",
						confidence: "low" as const,
						sources: fact.sources,
					}))
				: []),
		],
		concerns: findings.redTeam.concerns,
		attributionSnippets: [
			{
				label: "In-article attribution (quoted claim)",
				text: '"<insert verified claim from the package>," said a source verified via Objection\'s independent certification process.',
			},
			{
				label: "Short article sentence",
				text: `Objection reviewed a privacy-preserving evidence package and classified it as ${tier}, with a ${score}/100 confidence score for process rigor and metadata integrity.`,
			},
			{
				label: "Cautious editor note",
				text: "The certificate documents upload, hashing, processing, privacy, and provenance checks; it does not certify that any underlying allegation is true.",
			},
			{
				label: "Source attribution",
				text: "The package was reviewed through Objection's independent certification process without exposing source-identifying details.",
			},
			{
				label: "Methodology disclosure",
				text: `Objection hashed the uploaded package, recorded private processing steps, ran structured review checks, and published the methodology hash ${methodologyHash()}.`,
			},
			{
				label: "Limitation language",
				text: "The public truth certificate exposes integrity metadata and review limitations, but not raw evidence, original source access, or content-specific claims unless reviewer findings provide them.",
			},
		],
		privacyRedactions: [
			"Original file names stay private.",
			"Raw text, media, identity details, upload links, storage keys, and reviewer notes stay private.",
			"Artifact cards only include reviewer-confirmed findings.",
		],
		limitations: [
			"Anyone can hash a file; hashing supports integrity checks but does not prove content truth.",
			"External timestamp anchoring is disclosed as unavailable unless a proof is attached in the provenance ledger.",
			"No public source independently verifies the uploaded materials unless external checks are supplied.",
			"The final tier is intentionally conservative when evidence remains source-controlled or metadata-only.",
		],
		findings,
		methodologyHash: methodologyHash(),
	};
}
