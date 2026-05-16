import { describe, expect, it } from "vitest";
import {
	applyPseudonyms,
	type ExtractedEntity,
	findMatchingPackageEntity,
	nextPseudonym,
	type PackageEntity,
	type PseudonymDictionary,
} from "./pseudonyms";

function packageEntity(overrides: Partial<PackageEntity> = {}): PackageEntity {
	return {
		id: overrides.id ?? "entity-1",
		packageId: overrides.packageId ?? "package-1",
		kind: overrides.kind ?? "person",
		realName: overrides.realName ?? "John Smith",
		pseudonym: overrides.pseudonym ?? "Person A",
		variants: overrides.variants ?? ["John Smith"],
		firstSeenArtifactId: overrides.firstSeenArtifactId ?? "artifact-1",
		mergeConfidence: overrides.mergeConfidence ?? "high",
		mergeNotes: overrides.mergeNotes ?? null,
		createdAt: overrides.createdAt ?? new Date("2026-05-15T00:00:00.000Z"),
	};
}

function extractedEntity(
	overrides: Partial<ExtractedEntity> = {},
): ExtractedEntity {
	return {
		kind: overrides.kind ?? "person",
		canonical: overrides.canonical ?? "John",
		variants: overrides.variants ?? ["John Smith"],
		mergeConfidence: overrides.mergeConfidence ?? "high",
		mergeNotes: overrides.mergeNotes,
	};
}

describe("package pseudonyms", () => {
	it("matches variants case-insensitively during entity resolution", () => {
		const match = findMatchingPackageEntity(
			extractedEntity({ canonical: "john" }),
			[
				packageEntity({
					realName: "John Smith",
					variants: ["Mr. Smith", "JOHN SMITH"],
				}),
			],
		);

		expect(match?.pseudonym).toBe("Person A");
	});

	it("generates person letters and non-person Greek labels before pairs", () => {
		expect(nextPseudonym("person", 0)).toBe("Person A");
		expect(nextPseudonym("person", 26)).toBe("Person AA");
		expect(nextPseudonym("org", 0)).toBe("Org α");
		expect(nextPseudonym("org", 24)).toBe("Org AA");
	});

	it("replaces longest variants first without eating adjacent names", () => {
		const dict: PseudonymDictionary = [
			{
				kind: "person",
				realName: "John",
				variants: ["John Smith"],
				pseudonym: "Person A",
			},
		];

		expect(applyPseudonyms("John Smith spoke with Johnson.", dict)).toBe(
			"Person A spoke with Johnson.",
		);
	});

	it("applies replacements case-insensitively", () => {
		const dict: PseudonymDictionary = [
			{
				kind: "org",
				realName: "Acme Corp",
				variants: ["Acme"],
				pseudonym: "Org α",
			},
		];

		expect(applyPseudonyms("ACME sent a memo to Acme Corp.", dict)).toBe(
			"Org α sent a memo to Org α.",
		);
	});

	it("redacts common high-risk identifiers left after pseudonym substitution", () => {
		const input =
			"test@example.com 415-555-0100 123-45-6789 4111 1111 1111 1111";

		expect(applyPseudonyms(input, [])).toBe(
			"[redacted] [redacted] [redacted] [redacted]",
		);
	});
});
