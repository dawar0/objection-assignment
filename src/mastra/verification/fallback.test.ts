import { describe, expect, it } from "vitest";
import {
	buildClaimMatrix,
	fallbackCertificatePayload,
	isProcessOnlyClaim,
	isProcessOnlyTimelineItem,
	normalizeCertificatePayloadForDisplay,
} from "./fallback";
import { type PseudonymDictionary, sweepPublicStrings } from "./pseudonyms";
import type { ExternalFactInput } from "./schemas";

const SEEDED_FACTS: ExternalFactInput[] = [
	{
		id: "f1",
		claim: "Hargrove Lab is a recognized institutional research group.",
		sources: [
			{
				url: "https://institution.example/lab/hargrove",
				title: "Hargrove Lab — institutional page",
				snippet: "Principal investigator and ongoing gene therapy work.",
				accessedAt: "2026-05-14T00:00:00.000Z",
			},
		],
	},
	{
		id: "f2",
		claim: "Vasquez et al. 2024 is an indexed publication.",
		sources: [
			{
				url: "https://pubmed.example/2024/vasquez",
				title: "Vasquez et al. 2024",
				snippet: "Indexed publication abstract.",
				accessedAt: "2026-05-14T00:00:00.000Z",
			},
		],
	},
];

describe("fallbackCertificatePayload", () => {
	it("puts the brief-style in-article attribution snippet first", () => {
		const payload = fallbackCertificatePayload();
		expect(payload.attributionSnippets.length).toBeGreaterThan(0);
		const first = payload.attributionSnippets[0];
		expect(first.label).toBe("In-article attribution (quoted claim)");
		expect(first.text).toContain(
			"said a source verified via Objection's independent certification process",
		);
	});

	it("uses unavailable for missing fallback manifest hashes", () => {
		const payload = fallbackCertificatePayload();
		expect(payload.provenanceLedger.manifestHash).toBe("unavailable");
	});

	it("does not emit a lumped Firecrawl externalChecks entry", () => {
		const payload = fallbackCertificatePayload({
			seededExternalFacts: SEEDED_FACTS,
		});
		expect(
			payload.externalChecks.some(
				(check) =>
					check.label === "Public-web corroboration search (Firecrawl)",
			),
		).toBe(false);
	});

	it("emits one externalChecks entry per seeded fact when no reviewer publicFacts exist", () => {
		const payload = fallbackCertificatePayload({
			seededExternalFacts: SEEDED_FACTS,
		});
		const factChecks = payload.externalChecks.filter(
			(check) => check.result === "pending",
		);

		expect(factChecks).toHaveLength(2);
		expect(factChecks[0].label).toBe(
			"Hargrove Lab is a recognized institutional research group.",
		);
		expect(factChecks[0].sources).toEqual(SEEDED_FACTS[0].sources);
		expect(factChecks[1].label).toBe(
			"Vasquez et al. 2024 is an indexed publication.",
		);
		expect(factChecks[1].sources).toEqual(SEEDED_FACTS[1].sources);
	});

	it("omits seeded facts when there are no seeded inputs", () => {
		const payload = fallbackCertificatePayload();
		expect(payload.externalChecks).toEqual([]);
	});

	it("still renders the certificate without exposing source-identifying fields", () => {
		const payload = fallbackCertificatePayload({
			manifestFiles: [
				{
					artifactId: "art-1",
					label: "private original name should not render",
					mimeType: "text/plain",
					sizeBytes: 1234,
					sha256: "b".repeat(64),
				},
			],
			seededExternalFacts: SEEDED_FACTS,
		});

		expect(JSON.stringify(payload)).not.toContain(
			"private original name should not render",
		);
	});

	it("uses data-only fallback artifact cards without generic boilerplate", () => {
		const payload = fallbackCertificatePayload({
			manifestFiles: [
				{
					artifactId: "pdf-1",
					label: "private original name should not render",
					mimeType: "application/pdf",
					sizeBytes: 4608,
					sha256: "c".repeat(64),
				},
			],
		});
		const artifact = payload.artifactSummaries[0];
		const serialized = JSON.stringify(payload);

		expect(artifact?.role).toBe("");
		expect(artifact?.publicSafeSynopsis).toBe("");
		expect(artifact?.processingSummary).toBe("");
		expect(artifact?.signals).toEqual([]);
		expect(artifact?.excerpts).toEqual([]);
		expect(artifact?.limitations).toEqual([]);
		expect(artifact?.metadata).toEqual([
			{ label: "MIME type", value: "application/pdf" },
			{ label: "Size", value: "4,608 bytes" },
			{ label: "SHA-256", value: `${"c".repeat(12)}...${"c".repeat(8)}` },
			{ label: "Chunks", value: "1 private chunk" },
		]);
		expect(serialized).not.toContain("Records a pdf upload");
		expect(serialized).not.toContain(
			"SHA-256 hash and file size are recorded for integrity checking.",
		);
		expect(serialized).not.toContain(
			"Private extraction and chunking status are recorded for reviewer traceability.",
		);
		expect(serialized).not.toContain(
			"Public language is limited to processing facts",
		);
		expect(serialized).not.toContain("metadata-only summary");
		expect(serialized).not.toContain("privacy treatment");
		expect(serialized).not.toContain("Metadata alone cannot verify authorship");
	});

	it("uses persisted per-artifact summaries when present", () => {
		const payload = fallbackCertificatePayload({
			manifestFiles: [
				{
					artifactId: "artifact-a",
					label: "private original name should not render",
					mimeType: "text/plain",
					sizeBytes: 2048,
					sha256: "d".repeat(64),
					role: "Person A authored a memo.",
					processingSummary: "Text extraction produced a public-safe synopsis.",
					publicSafeSynopsis: "Person A describes a dispute involving Org α.",
					signals: ["Person A and Org α appear together."],
					limitations: ["The artifact does not independently prove the claim."],
					excerpts: [
						{
							locator: "line 1",
							text: "Person A wrote to Org α.",
							citationType: "excerpt",
						},
					],
					summaryStatus: "partial",
				},
			],
		});

		const artifact = payload.artifactSummaries[0];

		expect(artifact?.role).toBe("Person A authored a memo.");
		expect(artifact?.processingSummary).toBe(
			"Text extraction produced a public-safe synopsis.",
		);
		expect(artifact?.publicSafeSynopsis).toBe(
			"Person A describes a dispute involving Org α.",
		);
		expect(artifact?.signals).toEqual(["Person A and Org α appear together."]);
		expect(artifact?.limitations).toEqual([
			"The artifact does not independently prove the claim.",
		]);
		expect(artifact?.excerpts).toEqual([
			{
				locator: "line 1",
				text: "Person A wrote to Org α.",
				citationType: "excerpt",
			},
		]);
		expect(artifact?.extractionStatus).toBe("partial");
	});

	it("does not turn fallback process facts into claim matrix rows", () => {
		const payload = fallbackCertificatePayload();
		const serializedClaims = JSON.stringify(payload.claimMatrix);

		expect(payload.claimMatrix).toEqual([]);
		expect(serializedClaims).not.toContain("SHA-256");
		expect(serializedClaims).not.toContain("Private extraction");
		expect(serializedClaims).not.toContain("raw artifact content");
	});

	it("classifies process-only claims without excluding content claims", () => {
		expect(
			isProcessOnlyClaim(
				"The package contains uploaded artifacts with recorded SHA-256 hashes.",
			),
		).toBe(true);
		expect(
			isProcessOnlyClaim(
				"Private extraction and chunk records exist for reviewer retrieval.",
			),
		).toBe(true);
		expect(
			isProcessOnlyClaim(
				"The public truth certificate withholds raw artifact content.",
			),
		).toBe(true);
		expect(
			isProcessOnlyClaim(
				"The witness described the same grant manipulation concerns in the audio.",
			),
		).toBe(false);
	});

	it("strips legacy artifact boilerplate from stored payloads for display", () => {
		const payload = fallbackCertificatePayload();
		const firstArtifact = payload.artifactSummaries[0];
		expect(firstArtifact).toBeDefined();
		if (!firstArtifact) {
			return;
		}
		const normalized = normalizeCertificatePayloadForDisplay({
			...payload,
			artifactSummaries: [
				{
					...firstArtifact,
					role: "Records a pdf upload in the evidence package without making public claims about its contents.",
					processingSummary:
						"PDF upload was hashed, extracted into private chunks when possible, content-hashed, and represented publicly through metadata-only findings.",
					publicSafeSynopsis:
						"This artifact is represented from verified upload metadata and private processing records only. The public truth certificate does not infer its subject matter.",
					signals: [
						"SHA-256 hash and file size are recorded for integrity checking.",
						"Private extraction and chunking status are recorded for reviewer traceability.",
						"Artifact-specific reviewer signal",
					],
					limitations: [
						"The public truth certificate does not expose raw content, original filenames, or source-identifying details.",
						"Artifact-specific reviewer limit",
					],
					excerpts: [
						{
							locator: "metadata-only summary",
							citationType: "paraphrase",
							text: "The artifact was received and processed; no public-safe content excerpt is available.",
						},
						{
							locator: "reviewer excerpt",
							citationType: "paraphrase",
							text: "Artifact-specific reviewer excerpt.",
						},
					],
				},
			],
		});
		const artifact = normalized.artifactSummaries[0];

		expect(artifact?.role).toBe("");
		expect(artifact?.processingSummary).toBe("");
		expect(artifact?.publicSafeSynopsis).toBe("");
		expect(artifact?.signals).toEqual(["Artifact-specific reviewer signal"]);
		expect(artifact?.limitations).toEqual(["Artifact-specific reviewer limit"]);
		expect(artifact?.excerpts).toEqual([
			{
				locator: "reviewer excerpt",
				citationType: "paraphrase",
				text: "Artifact-specific reviewer excerpt.",
			},
		]);
	});

	it("strips legacy process-only claim matrix rows for display", () => {
		const payload = fallbackCertificatePayload();
		const normalized = normalizeCertificatePayloadForDisplay({
			...payload,
			claimMatrix: [
				{
					claim:
						"The package contains uploaded artifacts with recorded SHA-256 hashes.",
					confidence: "high",
					supportLevel: "multi_artifact",
					supportingArtifacts: [],
					contradictingArtifacts: [],
					externallyCheckable: false,
					publicCorroboration:
						"No independent public source directly verifies this claim.",
					riskNotes: "Process-only claim.",
				},
				{
					claim:
						"The witness described grant manipulation concerns in the audio.",
					confidence: "medium",
					supportLevel: "single_artifact",
					supportingArtifacts: [],
					contradictingArtifacts: [],
					externallyCheckable: false,
					publicCorroboration:
						"No independent public source directly verifies this claim.",
					riskNotes: "Content claim retained.",
				},
			],
		});

		expect(normalized.claimMatrix.map((item) => item.claim)).toEqual([
			"The witness described grant manipulation concerns in the audio.",
		]);
	});

	it("strips fallback process-only timeline rows for display without losing reviewer timelines", () => {
		const payload = fallbackCertificatePayload();
		const processTimeline = payload.timeline[0];
		expect(processTimeline).toBeDefined();
		if (!processTimeline) {
			return;
		}
		const contentTimeline = {
			...processTimeline,
			event: "A witness conversation described grant manipulation concerns.",
			dateText: "reported in the uploaded audio transcript",
		};
		const normalized = normalizeCertificatePayloadForDisplay({
			...payload,
			timeline: [processTimeline, contentTimeline],
		});

		expect(isProcessOnlyTimelineItem(processTimeline)).toBe(true);
		expect(isProcessOnlyTimelineItem(contentTimeline)).toBe(false);
		expect(normalized.timeline.map((item) => item.event)).toEqual([
			contentTimeline.event,
		]);
	});

	it("dedupes entity aliases and backfills entity summaries for display", () => {
		const payload = fallbackCertificatePayload();
		const citation = payload.provenanceLedger.files[0];
		expect(citation).toBeDefined();
		if (!citation) return;

		const normalized = normalizeCertificatePayloadForDisplay({
			...payload,
			findings: {
				...payload.findings,
				internal: {
					...payload.findings.internal,
					entityConsistency: [
						{
							entity: "Person A",
							aliases: ["Person A", "person a", "Researcher A", "Researcher A"],
							summary: "",
							consistency: "ambiguous" as const,
							citations: [
								{
									artifactId: citation.artifactId,
									label: citation.label,
									snippet: "Person A appears in two cited excerpts.",
								},
							],
						},
					],
				},
			},
		});

		expect(normalized.findings.internal.entityConsistency).toEqual([
			expect.objectContaining({
				entity: "Person A",
				aliases: ["Researcher A"],
				summary:
					"Person A appears in the cited evidence with ambiguous consistency.",
			}),
		]);
	});

	it("marks claim matrix rows externally checkable from verified public facts", () => {
		const payload = fallbackCertificatePayload();
		const citation = payload.provenanceLedger.files[0];
		expect(citation).toBeDefined();
		if (!citation) return;
		const artifactCitation = {
			artifactId: citation.artifactId,
			label: citation.label,
			snippet: "Hargrove Lab appears in the cited evidence.",
		};

		const findings = {
			findings: {
				...payload.findings,
				internal: {
					...payload.findings.internal,
					coreClaims: [
						{
							id: "claim-1",
							claim:
								"Hargrove Lab is a recognized institutional research group.",
							supportingArtifacts: [artifactCitation],
							contradictingArtifacts: [],
							confidence: "medium" as const,
						},
					],
				},
				external: {
					...payload.findings.external,
					publicFacts: [
						{
							factId: "f1",
							claim:
								"Hargrove Lab is a recognized institutional research group.",
							result: "verified" as const,
							sources: SEEDED_FACTS[0].sources,
							notes: "Institutional source found.",
							supportingArtifacts: [artifactCitation],
						},
					],
				},
			},
		}.findings;

		const [claim] = buildClaimMatrix(findings);
		expect(claim?.externallyCheckable).toBe(true);
		expect(claim?.supportLevel).toBe("external_context");
	});

	it("sweeps planted real names from public certificate fields", () => {
		const payload = fallbackCertificatePayload();
		const dict: PseudonymDictionary = [
			{
				kind: "person",
				realName: "John Smith",
				variants: ["John"],
				pseudonym: "Person A",
			},
			{
				kind: "org",
				realName: "Acme Corp",
				variants: ["Acme"],
				pseudonym: "Org α",
			},
		];
		const swept = sweepPublicStrings(
			{
				...payload,
				verifiedSummary: "John Smith described Acme Corp.",
				attributionSnippets: [{ label: "Snippet", text: "John emailed Acme." }],
			},
			dict,
		);

		const serialized = JSON.stringify(swept.value);
		expect(swept.residualMatches).toEqual(
			expect.arrayContaining(["John Smith", "Acme Corp", "John", "Acme"]),
		);
		expect(serialized).toContain("Person A described Org α.");
		expect(serialized).toContain("Person A emailed Org α.");
		expect(serialized).not.toContain("John Smith");
		expect(serialized).not.toContain("Acme Corp");
	});
});
