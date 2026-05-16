import { describe, expect, it } from "vitest";
import { summarizeArtifactWithPseudonyms } from "./document-summary";
import type { ExtractedEntity, PackageEntity } from "./pseudonyms";

function entity(overrides: Partial<PackageEntity> = {}): PackageEntity {
	return {
		id: overrides.id ?? "entity-1",
		packageId: overrides.packageId ?? "package-1",
		kind: overrides.kind ?? "person",
		realName: overrides.realName ?? "John Smith",
		pseudonym: overrides.pseudonym ?? "Person A",
		variants: overrides.variants ?? ["John Smith", "John"],
		firstSeenArtifactId: overrides.firstSeenArtifactId ?? "artifact-1",
		mergeConfidence: overrides.mergeConfidence ?? "high",
		mergeNotes: overrides.mergeNotes ?? null,
		createdAt: overrides.createdAt ?? new Date("2026-05-15T00:00:00.000Z"),
	};
}

describe("summarizeArtifactWithPseudonyms", () => {
	it("sweeps real names returned by a mocked summary agent", async () => {
		const resolvedTable = [entity()];
		const result = await summarizeArtifactWithPseudonyms(
			{
				packageId: "package-1",
				artifactId: "artifact-1",
				label: "Artifact A: text upload",
				mimeType: "text/plain",
				sizeBytes: 128,
				extractedText: "John Smith wrote a memo.",
			},
			{
				existingEntitiesLoader: async () => [],
				entityExtractor: async () => ({
					ok: true,
					entities: [
						{
							kind: "person",
							canonical: "John Smith",
							variants: ["John"],
							mergeConfidence: "high",
						} satisfies ExtractedEntity,
					],
				}),
				entityResolver: async () => ({
					table: resolvedTable,
					newMerges: [
						{
							artifactId: "artifact-1",
							kind: "person",
							canonical: "John Smith",
							pseudonym: "Person A",
							action: "created",
							mergeConfidence: "high",
						},
					],
				}),
				summaryAgent: {
					generate: async () => ({
						object: {
							role: "John Smith authored the memo.",
							processingSummary: "John Smith was named in extracted text.",
							publicSafeSynopsis: "John Smith described the issue.",
							signals: ["John Smith appears as the author."],
							limitations: ["John Smith identity is private."],
							excerpts: [
								{
									locator: "p. 1",
									text: "John Smith wrote a memo.",
									citationType: "excerpt",
								},
							],
						},
					}),
				},
			},
		);

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		const serialized = JSON.stringify(result.data);
		expect(serialized).toContain("Person A");
		expect(serialized).not.toContain("John Smith");
		expect(result.mergeLog).toHaveLength(1);
	});
});
