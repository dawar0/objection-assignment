import { createStep, createWorkflow } from "@mastra/core/workflows";
import { logger } from "@trigger.dev/sdk/v3";
import { asc, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../../db";
import { sourceArtifacts } from "../../db/schema";
import {
	buildClaimMatrix,
	fallbackCertificatePayload,
	fallbackFindings,
} from "../verification/fallback";
import {
	buildDictionary,
	loadPackageEntities,
	sweepPublicStrings,
} from "../verification/pseudonyms";
import {
	certificatePayloadSchema,
	type ExternalFactInput,
	externalCorroborationOutputSchema,
	externalFactInputSchema,
	internalConsistencyOutputSchema,
	redTeamOutputSchema,
} from "../verification/schemas";
import { scoreVerificationRun, tierDefinition } from "../verification/scoring";

const workflowInputSchema = z.object({
	packageId: z.string(),
	artifactContext: z.string(),
	externalFacts: z.array(externalFactInputSchema).default([]),
	mergeLog: z.string().default(""),
	manifestHash: z.string().optional(),
	intakeTimestamp: z.string().optional(),
	finalizedAt: z.string().optional(),
	anchorStatus: z.string().optional(),
	anchorProof: z.record(z.string(), z.unknown()).nullish(),
});

function formatFactsForPrompt(facts: ExternalFactInput[]) {
	if (facts.length === 0) {
		return "No public-checkable facts were extracted from this package.";
	}
	return facts
		.map((fact) => {
			const sourceLines = fact.sources.length
				? fact.sources
						.map(
							(source) =>
								`  - ${source.title} (${source.url})\n    ${source.snippet}`,
						)
						.join("\n")
				: "  - (no public results returned for this fact)";
			return `FACT ${fact.id}: "${fact.claim}"\nSources:\n${sourceLines}`;
		})
		.join("\n\n");
}

const internalConsistencyStep = createStep({
	id: "internal-consistency",
	inputSchema: workflowInputSchema,
	outputSchema: internalConsistencyOutputSchema,
	execute: async ({ inputData, mastra }) => {
		const fallback = fallbackFindings(inputData.packageId).internal;
		try {
			const agent = mastra?.getAgent("internalConsistencyAgent");
			logger.info("LLM call start: internalConsistencyAgent", {
				packageId: inputData.packageId,
				artifactContextChars: inputData.artifactContext.length,
			});
			const response = await agent?.generate(
				`Review this evidence context. Return JSON matching the schema. For each entityConsistency[] item, include a concise public-safe summary of the entity's role and consistency across the cited evidence.\n\n${inputData.artifactContext}`,
				{ structuredOutput: { schema: internalConsistencyOutputSchema } },
			);
			logger.info("LLM call complete: internalConsistencyAgent", {
				packageId: inputData.packageId,
				hasObject: Boolean(response?.object),
				usage: response?.usage,
			});
			return response?.object ?? fallback;
		} catch (error) {
			logger.error("LLM call failed: internalConsistencyAgent", {
				packageId: inputData.packageId,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				...fallback,
				status: "degraded" as const,
				limits: [
					...fallback.limits,
					"Reviewer call failed; metadata-only findings used.",
				],
			};
		}
	},
});

const externalCorroborationStep = createStep({
	id: "external-corroboration",
	inputSchema: workflowInputSchema,
	outputSchema: externalCorroborationOutputSchema,
	execute: async ({ inputData, mastra }) => {
		const fallback = fallbackFindings(inputData.packageId).external;
		if (inputData.externalFacts.length === 0) {
			return {
				...fallback,
				limits: [
					...fallback.limits,
					"No public-checkable facts were inferred from this package; external corroboration was not run.",
				],
			};
		}
		try {
			const agent = mastra?.getAgent("externalCorroborationAgent");
			logger.info("LLM call start: externalCorroborationAgent", {
				packageId: inputData.packageId,
				factCount: inputData.externalFacts.length,
				artifactContextChars: inputData.artifactContext.length,
			});
			const response = await agent?.generate(
				`Classify each FACT below using only its own listed sources. Return JSON matching the schema, with one publicFacts[] entry per FACT (echo the factId verbatim).

ARTIFACT CONTEXT:
${inputData.artifactContext}

${formatFactsForPrompt(inputData.externalFacts)}`,
				{ structuredOutput: { schema: externalCorroborationOutputSchema } },
			);
			logger.info("LLM call complete: externalCorroborationAgent", {
				packageId: inputData.packageId,
				hasObject: Boolean(response?.object),
				usage: response?.usage,
			});
			return response?.object ?? fallback;
		} catch (error) {
			logger.error("LLM call failed: externalCorroborationAgent", {
				packageId: inputData.packageId,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				...fallback,
				status: "degraded" as const,
				limits: [
					...fallback.limits,
					"External reviewer call failed; metadata-only findings used.",
				],
			};
		}
	},
});

const redTeamStep = createStep({
	id: "red-team",
	inputSchema: workflowInputSchema,
	outputSchema: redTeamOutputSchema,
	execute: async ({ inputData, mastra }) => {
		const fallback = fallbackFindings(inputData.packageId).redTeam;
		try {
			const agent = mastra?.getAgent("redTeamAgent");
			logger.info("LLM call start: redTeamAgent", {
				packageId: inputData.packageId,
				mergeLogChars: inputData.mergeLog.length,
				artifactContextChars: inputData.artifactContext.length,
			});
			const response = await agent?.generate(
				`Red-team this anonymous evidence context. Return JSON matching the schema.
Flag low-confidence pseudonym merge decisions as verification concerns when they could materially affect interpretation.

PSEUDONYM MERGE LOG:
${inputData.mergeLog}

ARTIFACT CONTEXT:
${inputData.artifactContext}`,
				{ structuredOutput: { schema: redTeamOutputSchema } },
			);
			logger.info("LLM call complete: redTeamAgent", {
				packageId: inputData.packageId,
				hasObject: Boolean(response?.object),
				usage: response?.usage,
			});
			return response?.object ?? fallback;
		} catch (error) {
			logger.error("LLM call failed: redTeamAgent", {
				packageId: inputData.packageId,
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				...fallback,
				status: "degraded" as const,
				missingChecks: [
					...fallback.missingChecks,
					"Red-team reviewer call failed; metadata-only findings used.",
				],
			};
		}
	},
});

const scoreAndCertificateStep = createStep({
	id: "score-and-certificate",
	inputSchema: z.object({
		"internal-consistency": internalConsistencyOutputSchema,
		"external-corroboration": externalCorroborationOutputSchema,
		"red-team": redTeamOutputSchema,
	}),
	outputSchema: certificatePayloadSchema,
	execute: async ({ inputData, getInitData }) => {
		const initData = getInitData<z.infer<typeof workflowInputSchema>>();
		const artifacts = await db
			.select()
			.from(sourceArtifacts)
			.where(eq(sourceArtifacts.packageId, initData.packageId))
			.orderBy(asc(sourceArtifacts.createdAt), asc(sourceArtifacts.id));
		const packageEntities = await loadPackageEntities(initData.packageId);
		const dict = buildDictionary(packageEntities);
		const manifestFiles = artifacts.map((artifact) => ({
			artifactId: artifact.id,
			label: artifact.sanitizedLabel,
			mimeType: artifact.mimeType,
			sizeBytes: artifact.sizeBytes,
			sha256: artifact.sha256 ?? "unavailable",
			role: artifact.role,
			processingSummary: artifact.processingSummary,
			publicSafeSynopsis: artifact.publicSafeSynopsis,
			signals: artifact.signals,
			limitations: artifact.limitations,
			excerpts: artifact.publicExcerpts,
			summaryStatus: artifact.summaryStatus,
		}));
		const findings = {
			internal: inputData["internal-consistency"],
			external: inputData["external-corroboration"],
			redTeam: inputData["red-team"],
		};
		const tier = scoreVerificationRun(findings);
		const publicDossier = fallbackCertificatePayload({
			manifestFiles,
			manifestHash: initData.manifestHash,
			intakeTimestamp: initData.intakeTimestamp,
			finalizedAt: initData.finalizedAt,
			anchorStatus: initData.anchorStatus,
			anchorProof: initData.anchorProof ?? null,
		});

		const payload = {
			...publicDossier,
			tier,
			tierDefinition: tierDefinition(tier),
			verifiedSummary:
				"This certificate documents a structured review of uploaded materials, private processing records, and any supplied public corroboration sources.",
			checkedItems: [
				"Internal consistency across cited artifact chunks",
				"Supplied public entities and source URLs",
				"Adversarial concerns and missing checks",
			],
			claimMatrix: buildClaimMatrix(findings),
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
			],
			concerns: findings.redTeam.concerns,
			attributionSnippets: [
				...publicDossier.attributionSnippets.filter(
					(snippet) =>
						snippet.label === "In-article attribution (quoted claim)",
				),
				{
					label: "Article sentence",
					text: `Objection classified the package as ${tier}: ${tierDefinition(tier)}`,
				},
				...publicDossier.attributionSnippets.filter(
					(snippet) =>
						snippet.label !== "Short article sentence" &&
						snippet.label !== "In-article attribution (quoted claim)",
				),
			],
			findings,
		};
		const swept = sweepPublicStrings(payload, dict);
		if (swept.residualMatches.length > 0) {
			logger.warn(
				"Certificate-level pseudonym sweep caught real entity strings",
				{
					packageId: initData.packageId,
					matches: swept.residualMatches,
				},
			);
		}
		return swept.value;
	},
});

export const verificationWorkflow = createWorkflow({
	id: "verification-workflow",
	inputSchema: workflowInputSchema,
	outputSchema: certificatePayloadSchema,
})
	.parallel([internalConsistencyStep, externalCorroborationStep, redTeamStep])
	.then(scoreAndCertificateStep);

verificationWorkflow.commit();
