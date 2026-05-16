import { scoreVerificationRun } from "./scoring";

export const METHODOLOGY_VERSION = "objection-tribunal-protocol-v0.1.0";
export const METHODOLOGY_HASH =
	"f346ff01b8548bad69a7a76c17f5da8cb857eb278c651ce1344f3677819d7709";

export const EMBEDDING_SETTINGS = {
	model: "text-embedding-3-small",
	chunkSizeTokensApprox: 1200,
	overlapTokensApprox: 150,
	topKPerReviewerTask: 8,
	artifactDiversity: true,
};

export const REVIEW_MODEL = "openai/gpt-5.5";

export const REVIEW_PROMPTS = {
	internal:
		"Review uploaded evidence for internal consistency. Return only structured JSON matching the schema. Every claim must cite uploaded artifact chunks.",
	external:
		"Extract publicly checkable entities and classify Firecrawl results. Return only structured JSON matching the schema. Never invent a URL.",
	redTeam:
		"Argue that the package may be fabricated or incomplete. Return structured concerns with artifact citations and public-safe explanations.",
};

export function methodologyBundle() {
	return {
		version: METHODOLOGY_VERSION,
		reviewModel: REVIEW_MODEL,
		embedding: EMBEDDING_SETTINGS,
		prompts: REVIEW_PROMPTS,
		scoringSource: scoreVerificationRun.toString(),
		tierDefinitions: {
			Substantiated: "Externally verified anchors plus low residual concern.",
			Corroborated: "Multiple artifacts plus meaningful external citations.",
			"Single-source":
				"Internally coherent but substantially source-controlled.",
			Disputed: "Material conflict or blocking concern.",
		},
	};
}

export function methodologyHash() {
	return METHODOLOGY_HASH;
}
