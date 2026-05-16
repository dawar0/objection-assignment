import type { Tier, VerificationFindings } from "./schemas";

export const SUBSTANTIATED_RATIO = 0.75;
export const MIN_VERIFIED_FOR_SUBSTANTIATED = 3;
export const SINGLE_SOURCE_RATIO = 0.4;
export const MIN_FACTS_FOR_TIER = 2;

export function scoreVerificationRun(findings: VerificationFindings): Tier {
	const disqualifyingContradiction = findings.internal.contradictions.some(
		(item) => item.severity === "disqualifying",
	);
	const materialContradiction = findings.internal.contradictions.some(
		(item) => item.severity === "material",
	);
	const contradictedFact = findings.external.publicFacts.some(
		(fact) => fact.result === "contradicted",
	);
	const contradictedEntity = findings.external.entityFindings.some(
		(item) => item.verificationStatus === "contradicted",
	);
	const blockingConcern = findings.redTeam.concerns.some(
		(item) => item.tierImpact === "blocking",
	);

	if (
		disqualifyingContradiction ||
		contradictedFact ||
		contradictedEntity ||
		blockingConcern
	) {
		return "Disputed";
	}

	const facts = findings.external.publicFacts.filter(
		(fact) => fact.sources.length > 0 || fact.result === "not_found",
	);
	const verifiedFacts = facts.filter(
		(fact) => fact.result === "verified" && fact.sources.length > 0,
	);
	const verifiedRatio =
		facts.length > 0 ? verifiedFacts.length / facts.length : 0;

	const citedCoreClaims = findings.internal.coreClaims.filter(
		(claim) => claim.supportingArtifacts.length > 0,
	);
	const highDowngradeConcern = findings.redTeam.concerns.some(
		(item) =>
			item.severity === "high" && item.tierImpact === "downgrade_signal",
	);

	if (
		materialContradiction ||
		highDowngradeConcern ||
		facts.length < MIN_FACTS_FOR_TIER ||
		verifiedRatio < SINGLE_SOURCE_RATIO
	) {
		return "Single-source";
	}

	const onlyLowConcerns = findings.redTeam.concerns.every(
		(item) => item.severity === "low",
	);
	const strongCorroboration =
		verifiedRatio >= SUBSTANTIATED_RATIO &&
		verifiedFacts.length >= MIN_VERIFIED_FOR_SUBSTANTIATED &&
		citedCoreClaims.length >= 4;

	if (strongCorroboration && onlyLowConcerns) {
		return "Substantiated";
	}

	return "Corroborated";
}

export function tierDefinition(tier: Tier) {
	const definitions: Record<Tier, string> = {
		Substantiated:
			"Key factual anchors were externally verified and the uploaded evidence has no material unresolved concerns.",
		Corroborated:
			"Multiple uploaded artifacts and public sources support the core claim, with limits disclosed.",
		"Single-source":
			"The package is internally coherent, but the material remains source-controlled or only partially corroborated.",
		Disputed:
			"Material contradictions, external conflicts, or blocking concerns prevent reliance on this package.",
	};

	return definitions[tier];
}
