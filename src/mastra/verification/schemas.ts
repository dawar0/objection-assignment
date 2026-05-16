import * as z from "zod";

export const tierSchema = z.enum([
	"Substantiated",
	"Corroborated",
	"Single-source",
	"Disputed",
]);

export const artifactCitationSchema = z.object({
	artifactId: z.string(),
	chunkId: z.string().optional(),
	label: z.string(),
	locator: z.string().optional(),
	snippet: z.string().min(1),
});

export const externalSourceSchema = z.object({
	url: z.string().min(1).describe("Absolute http(s) URL"),
	title: z.string().min(1),
	snippet: z.string().min(1),
	accessedAt: z.string().min(1),
});

export const reviewerStatusSchema = z.enum(["complete", "degraded"]);
export const severitySchema = z.enum(["low", "medium", "high"]);
export const contradictionSeveritySchema = z.enum([
	"minor",
	"material",
	"disqualifying",
]);

export const coreClaimSchema = z.object({
	id: z.string(),
	claim: z.string().min(1),
	supportingArtifacts: z.array(artifactCitationSchema).min(1),
	contradictingArtifacts: z.array(artifactCitationSchema),
	confidence: z.enum(["low", "medium", "high"]),
});

export const contradictionSchema = z.object({
	claim: z.string().min(1),
	severity: contradictionSeveritySchema,
	supportingArtifacts: z.array(artifactCitationSchema).min(1),
	contradictingArtifacts: z.array(artifactCitationSchema).min(1),
	publicExplanation: z.string().min(1),
});

export const timelineItemSchema = z.object({
	event: z.string().min(1),
	dateText: z.string().min(1),
	citations: z.array(artifactCitationSchema).min(1),
	confidence: z.enum(["low", "medium", "high"]),
});

export const entityConsistencySchema = z.object({
	entity: z.string().min(1),
	aliases: z.array(z.string()).default([]),
	summary: z
		.string()
		.min(1)
		.describe(
			"One concise public-safe summary of how this entity appears across the cited evidence.",
		)
		.default("This entity appears in the cited evidence package."),
	consistency: z.enum(["consistent", "ambiguous", "conflicting"]),
	citations: z.array(artifactCitationSchema).min(1),
});

export const internalConsistencyOutputSchema = z.object({
	status: reviewerStatusSchema,
	summary: z.string().min(1),
	coreClaims: z.array(coreClaimSchema),
	contradictions: z.array(contradictionSchema).default([]),
	timeline: z.array(timelineItemSchema).default([]),
	entityConsistency: z.array(entityConsistencySchema).default([]),
	limits: z.array(z.string()).default([]),
});

export const externalEntityFindingSchema = z.object({
	entity: z.string().min(1),
	entityType: z.enum([
		"paper",
		"journal",
		"person",
		"institution",
		"doi",
		"other",
	]),
	verificationStatus: z.enum([
		"verified",
		"partially_verified",
		"not_found",
		"contradicted",
	]),
	sources: z.array(externalSourceSchema).default([]),
	notes: z.string().min(1),
	confidence: z.enum(["low", "medium", "high"]),
	supportingArtifacts: z.array(artifactCitationSchema).default([]),
});

export const publicFactSchema = z.object({
	factId: z.string().min(1),
	claim: z.string().min(1),
	result: z.enum([
		"verified",
		"partially_verified",
		"not_found",
		"contradicted",
	]),
	sources: z.array(externalSourceSchema).default([]),
	notes: z.string().min(1),
	supportingArtifacts: z.array(artifactCitationSchema).default([]),
});

export const externalFactInputSchema = z.object({
	id: z.string().min(1),
	claim: z.string().min(1),
	sources: z.array(externalSourceSchema).default([]),
});

export const externalCorroborationOutputSchema = z.object({
	status: reviewerStatusSchema,
	summary: z.string().min(1),
	entityFindings: z.array(externalEntityFindingSchema),
	publicFacts: z.array(publicFactSchema).default([]),
	limits: z.array(z.string()).default([]),
});

export const redTeamConcernSchema = z.object({
	concern: z.string().min(1),
	severity: severitySchema,
	tierImpact: z.enum(["note_only", "downgrade_signal", "blocking"]),
	citations: z.array(artifactCitationSchema).min(1),
	publicExplanation: z.string().min(1),
});

export const redTeamOutputSchema = z.object({
	status: reviewerStatusSchema,
	summary: z.string().min(1),
	concerns: z.array(redTeamConcernSchema),
	fabricationHypotheses: z.array(
		z.object({
			hypothesis: z.string().min(1),
			citations: z.array(artifactCitationSchema).min(1),
			evidenceThatWouldReduceConcern: z.string().min(1),
		}),
	),
	missingChecks: z.array(z.string()).default([]),
	sourceIncentiveAssessment: z.string().min(1),
});

export const verificationFindingsSchema = z.object({
	internal: internalConsistencyOutputSchema,
	external: externalCorroborationOutputSchema,
	redTeam: redTeamOutputSchema,
});

export const attributionSnippetSchema = z.object({
	label: z.string(),
	text: z.string(),
});

export const provenanceFileSchema = z.object({
	artifactId: z.string(),
	label: z.string().min(1),
	evidenceType: z.string().min(1),
	mimeType: z.string().min(1),
	sizeBytes: z.number().int().nonnegative(),
	sha256: z.string().min(1),
	hashPreview: z.string().min(1),
	extractionStatus: z.string().min(1),
	chunkCount: z.number().int().nonnegative(),
	contentHashCount: z.number().int().nonnegative(),
	embeddedChunkCount: z.number().int().nonnegative(),
	manifestIncluded: z.boolean(),
	uploadedAt: z.string().min(1),
	finalizedAt: z.string().min(1),
	privacyTreatment: z.string().min(1),
});

export const provenanceLedgerSchema = z.object({
	intakeTimestamp: z.string().min(1),
	finalizedAt: z.string().min(1),
	manifestHash: z.string().min(1),
	methodologyHash: z.string().min(1),
	methodologyVersion: z.string().min(1),
	anchorStatus: z.string().min(1),
	anchorProofType: z.string().min(1),
	anchorProofNote: z.string().min(1),
	fileCount: z.number().int().nonnegative(),
	totalSizeBytes: z.number().int().nonnegative(),
	files: z.array(provenanceFileSchema),
});

export const publicExcerptSchema = z.object({
	locator: z.string().min(1),
	text: z.string().min(1),
	citationType: z.enum(["excerpt", "paraphrase"]),
});

export const artifactSummarySchema = z.object({
	artifactId: z.string(),
	label: z.string().min(1),
	evidenceType: z.string().min(1),
	role: z.string(),
	processingSummary: z.string(),
	publicSafeSynopsis: z.string(),
	extractionStatus: z.string().min(1),
	metadata: z.array(
		z.object({ label: z.string().min(1), value: z.string().min(1) }),
	),
	signals: z.array(z.string().min(1)),
	limitations: z.array(z.string().min(1)),
	excerpts: z.array(publicExcerptSchema),
});

export const claimMatrixItemSchema = z.object({
	claim: z.string().min(1),
	confidence: z.enum(["low", "medium", "high"]),
	supportLevel: z.enum([
		"single_artifact",
		"multi_artifact",
		"external_context",
		"contradicted",
	]),
	supportingArtifacts: z.array(artifactCitationSchema),
	contradictingArtifacts: z.array(artifactCitationSchema),
	externallyCheckable: z.boolean(),
	publicCorroboration: z.string().min(1),
	riskNotes: z.string().min(1),
});

export const publicExternalCheckSchema = z.object({
	label: z.string().min(1),
	result: z.string().min(1),
	whatItCorroborates: z.string().min(1),
	confidence: z.enum(["low", "medium", "high"]),
	sources: z.array(externalSourceSchema),
});

export const certificatePayloadSchema = z.object({
	tier: tierSchema,
	confidenceScore: z.number().int().min(0).max(100),
	tierDefinition: z.string(),
	verifiedSummary: z.string(),
	checkedItems: z.array(z.string()),
	provenanceLedger: provenanceLedgerSchema,
	artifactSummaries: z.array(artifactSummarySchema),
	claimMatrix: z.array(claimMatrixItemSchema),
	timeline: z.array(timelineItemSchema),
	externalChecks: z.array(publicExternalCheckSchema),
	concerns: z.array(redTeamConcernSchema),
	attributionSnippets: z.array(attributionSnippetSchema),
	privacyRedactions: z.array(z.string()),
	limitations: z.array(z.string()),
	findings: verificationFindingsSchema,
});

export type Tier = z.infer<typeof tierSchema>;
export type ArtifactCitation = z.infer<typeof artifactCitationSchema>;
export type ExternalSource = z.infer<typeof externalSourceSchema>;
export type ExternalFactInput = z.infer<typeof externalFactInputSchema>;
export type VerificationFindings = z.infer<typeof verificationFindingsSchema>;
export type CertificatePayload = z.infer<typeof certificatePayloadSchema>;
export type ProvenanceFile = z.infer<typeof provenanceFileSchema>;
export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;
export type ClaimMatrixItem = z.infer<typeof claimMatrixItemSchema>;

export function isValidHttpUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function sanitizeExternalSources(
	sources: ExternalSource[],
): ExternalSource[] {
	const seen = new Set<string>();
	const sanitized: ExternalSource[] = [];

	for (const source of sources) {
		const url = source.url.trim();
		if (!isValidHttpUrl(url) || seen.has(url)) continue;
		seen.add(url);
		sanitized.push({
			...source,
			url,
			title: source.title.trim() || url,
			snippet: source.snippet.trim() || "No snippet returned.",
			accessedAt: source.accessedAt.trim() || new Date().toISOString(),
		});
	}

	return sanitized;
}
