import { describe, expect, it } from "vitest";
import { fallbackCertificatePayload, fallbackFindings } from "./fallback";
import type { ArtifactCitation, VerificationFindings } from "./schemas";
import {
	certificatePayloadSchema,
	externalCorroborationOutputSchema,
	internalConsistencyOutputSchema,
	redTeamOutputSchema,
} from "./schemas";
import { scoreVerificationRun } from "./scoring";

function source(url: string) {
	return {
		url,
		title: `Title for ${url}`,
		snippet: `Snippet for ${url}`,
		accessedAt: new Date().toISOString(),
	};
}

function buildCoreClaims(
	supportingArtifacts: ArtifactCitation[],
	count: number,
) {
	return Array.from({ length: count }, (_, index) => ({
		id: `content-claim-${index + 1}`,
		claim: `A content-specific claim #${index + 1} is present in the submitted evidence.`,
		supportingArtifacts,
		contradictingArtifacts: [],
		confidence: "medium" as const,
	}));
}

function softenConcerns(findings: VerificationFindings) {
	for (const concern of findings.redTeam.concerns) {
		concern.severity = "low";
		concern.tierImpact = "note_only";
	}
}

describe("scoreVerificationRun", () => {
	it("classifies the metadata-only package as Single-source", () => {
		expect(scoreVerificationRun(fallbackFindings())).toBe("Single-source");
	});

	it("forces Disputed for a blocking red-team concern", () => {
		const findings = fallbackFindings();
		findings.redTeam.concerns[0].tierImpact = "blocking";

		expect(scoreVerificationRun(findings)).toBe("Disputed");
	});

	it("forces Disputed when any fact is contradicted by public sources", () => {
		const findings = fallbackFindings();
		softenConcerns(findings);
		const supportingArtifacts = findings.redTeam.concerns[0].citations;
		findings.external.publicFacts = [
			{
				factId: "f1",
				claim: "A fact under review.",
				result: "contradicted",
				sources: [source("https://example.com/contradiction")],
				notes: "Public source contradicts this fact.",
				supportingArtifacts,
			},
		];

		expect(scoreVerificationRun(findings)).toBe("Disputed");
	});

	it("lands at Corroborated when most facts are verified but coreClaims or verified count is too low for Substantiated", () => {
		const findings = fallbackFindings();
		softenConcerns(findings);
		const supportingArtifacts = findings.redTeam.concerns[0].citations;
		findings.internal.coreClaims = buildCoreClaims(supportingArtifacts, 2);
		findings.external.publicFacts = [
			{
				factId: "f1",
				claim: "Public fact one is verified.",
				result: "verified",
				sources: [source("https://example.com/source-1")],
				notes: "Public context fact one was supplied to the reviewer.",
				supportingArtifacts,
			},
			{
				factId: "f2",
				claim: "Public fact two is verified.",
				result: "verified",
				sources: [source("https://example.com/source-2")],
				notes: "Public context fact two was supplied to the reviewer.",
				supportingArtifacts,
			},
		];

		expect(scoreVerificationRun(findings)).toBe("Corroborated");
	});

	it("reaches Substantiated when verified ratio >= 75% across >= 3 facts with >= 4 cited core claims and only low concerns", () => {
		const findings = fallbackFindings();
		softenConcerns(findings);
		const supportingArtifacts = findings.redTeam.concerns[0].citations;
		findings.internal.coreClaims = buildCoreClaims(supportingArtifacts, 4);
		findings.external.publicFacts = [
			{
				factId: "f1",
				claim: "Fact one is verified.",
				result: "verified",
				sources: [source("https://example.com/v1")],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f2",
				claim: "Fact two is verified.",
				result: "verified",
				sources: [source("https://example.com/v2")],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f3",
				claim: "Fact three is verified.",
				result: "verified",
				sources: [source("https://example.com/v3")],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f4",
				claim: "Fact four is partially verified.",
				result: "partially_verified",
				sources: [source("https://example.com/p4")],
				notes: "",
				supportingArtifacts,
			},
		];
		// 3 verified / 4 total = 0.75

		expect(scoreVerificationRun(findings)).toBe("Substantiated");
	});

	it("drops to Single-source when verified ratio is below 40% even with many facts", () => {
		const findings = fallbackFindings();
		softenConcerns(findings);
		const supportingArtifacts = findings.redTeam.concerns[0].citations;
		findings.internal.coreClaims = buildCoreClaims(supportingArtifacts, 4);
		findings.external.publicFacts = [
			{
				factId: "f1",
				claim: "Fact one is verified.",
				result: "verified",
				sources: [source("https://example.com/v1")],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f2",
				claim: "Fact two not found.",
				result: "not_found",
				sources: [],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f3",
				claim: "Fact three not found.",
				result: "not_found",
				sources: [],
				notes: "",
				supportingArtifacts,
			},
		];
		// 1 verified / 3 total = 0.33

		expect(scoreVerificationRun(findings)).toBe("Single-source");
	});

	it("does not promote to Substantiated when one fact has many sources but verifiedFacts < 3", () => {
		const findings = fallbackFindings();
		softenConcerns(findings);
		const supportingArtifacts = findings.redTeam.concerns[0].citations;
		findings.internal.coreClaims = buildCoreClaims(supportingArtifacts, 4);
		findings.external.publicFacts = [
			{
				factId: "f1",
				claim: "A heavily corroborated fact.",
				result: "verified",
				sources: [
					source("https://example.com/s1"),
					source("https://example.com/s2"),
					source("https://example.com/s3"),
					source("https://example.com/s4"),
				],
				notes: "",
				supportingArtifacts,
			},
			{
				factId: "f2",
				claim: "A second verified fact.",
				result: "verified",
				sources: [source("https://example.com/s5")],
				notes: "",
				supportingArtifacts,
			},
		];
		// 2 verified / 2 total = 1.0 ratio, but verifiedFacts=2 < 3

		expect(scoreVerificationRun(findings)).toBe("Corroborated");
	});
});

describe("reviewer output citation invariants", () => {
	const findings = fallbackFindings();

	it("validates fallback reviewer outputs against the schemas", () => {
		expect(() =>
			internalConsistencyOutputSchema.parse(findings.internal),
		).not.toThrow();
		expect(() =>
			externalCorroborationOutputSchema.parse(findings.external),
		).not.toThrow();
		expect(() => redTeamOutputSchema.parse(findings.redTeam)).not.toThrow();
	});

	it("keeps artifact citations on every internal and red-team finding", () => {
		expect(
			findings.internal.coreClaims.every(
				(claim) => claim.supportingArtifacts.length > 0,
			),
		).toBe(true);
		expect(
			findings.redTeam.concerns.every(
				(concern) => concern.citations.length > 0,
			),
		).toBe(true);
	});

	it("keeps URL and snippet citations on verified external findings", () => {
		const verified = [
			...findings.external.entityFindings.filter(
				(item) => item.verificationStatus === "verified",
			),
			...findings.external.publicFacts.filter(
				(item) => item.result === "verified",
			),
		];

		expect(
			verified.every((item) =>
				item.sources.every(
					(source) =>
						source.url && source.title && source.snippet && source.accessedAt,
				),
			),
		).toBe(true);
	});
});

describe("rich certificate payload", () => {
	it("validates the public-safe dossier shape", () => {
		const payload = certificatePayloadSchema.parse(
			fallbackCertificatePayload(),
		);

		expect(payload.confidenceScore).toBeGreaterThan(0);
		expect(payload.provenanceLedger.files).toHaveLength(5);
		expect(
			payload.artifactSummaries.map((artifact) => artifact.evidenceType),
		).toEqual([
			"Text upload",
			"PDF upload",
			"Audio upload",
			"Image upload",
			"Binary upload",
		]);
		expect(payload.claimMatrix).toEqual([]);
		expect(payload.privacyRedactions).toEqual([
			"Original file names stay private.",
			"Raw text, media, identity details, upload links, storage keys, and reviewer notes stay private.",
			"Artifact cards only include reviewer-confirmed findings.",
		]);
		expect(payload.limitations.join(" ")).toContain(
			"does not prove content truth",
		);
	});

	it("uses provided manifest metadata without exposing original filenames", () => {
		const payload = fallbackCertificatePayload({
			manifestFiles: [
				{
					artifactId: "artifact-a",
					label: "private original name should not render",
					mimeType: "audio/mpeg",
					sizeBytes: 6185459,
					sha256: "a".repeat(64),
				},
			],
			manifestHash: "manifest-hash",
			anchorStatus: "unavailable",
		});

		expect(payload.provenanceLedger.manifestHash).toBe("manifest-hash");
		expect(payload.provenanceLedger.files[0]?.sha256).toBe("a".repeat(64));
		expect(payload.provenanceLedger.files[0]?.label).toBe(
			"Artifact A: Audio upload",
		);
		expect(JSON.stringify(payload)).not.toContain(
			"private original name should not render",
		);
	});
});
