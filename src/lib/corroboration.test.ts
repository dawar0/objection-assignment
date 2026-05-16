import { describe, expect, it } from "vitest";
import type { ExternalSource } from "../mastra/verification/schemas";
import {
	EMPTY_CORROBORATION_PROMPT_BLOCK,
	type FactCorroboration,
	formatPerFactCorroboration,
	MAX_TOTAL_RESULTS,
} from "./corroboration";

function makeSource(overrides: Partial<ExternalSource> = {}): ExternalSource {
	return {
		url: overrides.url ?? "https://example.org/a",
		title: overrides.title ?? "Example A",
		snippet: overrides.snippet ?? "Snippet A",
		accessedAt: overrides.accessedAt ?? "2026-05-14T00:00:00.000Z",
	};
}

function makeFact(
	overrides: Partial<FactCorroboration> = {},
): FactCorroboration {
	return {
		id: overrides.id ?? "f1",
		claim: overrides.claim ?? "A public-checkable claim.",
		queries: overrides.queries ?? ["a query"],
		sources: overrides.sources ?? [],
	};
}

describe("formatPerFactCorroboration", () => {
	it("returns the empty-corroboration sentinel when no facts are supplied", () => {
		const result = formatPerFactCorroboration([]);
		expect(result.facts).toEqual([]);
		expect(result.allSources).toEqual([]);
		expect(result.promptBlock).toBe(EMPTY_CORROBORATION_PROMPT_BLOCK);
	});

	it("builds a prompt block with one section per fact, listing queries and sources", () => {
		const result = formatPerFactCorroboration([
			makeFact({
				id: "f1",
				claim: "Hargrove Lab published gene therapy research.",
				queries: ["Hargrove lab gene therapy", "Hargrove lab publications"],
				sources: [
					makeSource({
						url: "https://uni.edu/lab",
						title: "Hargrove Lab",
						snippet: "PI page.",
					}),
				],
			}),
			makeFact({
				id: "f2",
				claim: "Vasquez published as a postdoc in 2024.",
				queries: ["Vasquez postdoc publications"],
				sources: [
					makeSource({
						url: "https://pubmed.gov/12345",
						title: "Vasquez 2024",
						snippet: "Abstract.",
					}),
				],
			}),
		]);

		expect(result.facts.map((f) => f.id)).toEqual(["f1", "f2"]);
		expect(result.allSources).toHaveLength(2);
		expect(result.promptBlock).toContain(
			'FACT f1: "Hargrove Lab published gene therapy research."',
		);
		expect(result.promptBlock).toContain(
			'Queries: "Hargrove lab gene therapy", "Hargrove lab publications"',
		);
		expect(result.promptBlock).toContain(
			"- Hargrove Lab (https://uni.edu/lab)\n  PI page.",
		);
		expect(result.promptBlock).toContain(
			'FACT f2: "Vasquez published as a postdoc in 2024."',
		);
		expect(result.promptBlock).toContain(
			"- Vasquez 2024 (https://pubmed.gov/12345)\n  Abstract.",
		);
	});

	it("deduplicates sources within a single fact", () => {
		const shared = makeSource({
			url: "https://shared.example/paper",
			title: "Shared Paper",
		});
		const result = formatPerFactCorroboration([
			makeFact({
				id: "f1",
				sources: [
					shared,
					shared,
					makeSource({ url: "https://other.example/b" }),
				],
			}),
		]);

		expect(result.facts[0].sources.map((s) => s.url)).toEqual([
			"https://shared.example/paper",
			"https://other.example/b",
		]);
	});

	it("drops non-http URLs before prompt formatting and persistence metadata", () => {
		const result = formatPerFactCorroboration([
			makeFact({
				sources: [
					makeSource({ url: "https://valid.example/a" }),
					makeSource({ url: "ftp://invalid.example/a" }),
					makeSource({ url: "not-a-url" }),
				],
			}),
		]);

		expect(result.facts[0].sources.map((source) => source.url)).toEqual([
			"https://valid.example/a",
		]);
		expect(result.allSources.map((source) => source.url)).toEqual([
			"https://valid.example/a",
		]);
		expect(result.promptBlock).toContain("https://valid.example/a");
		expect(result.promptBlock).not.toContain("ftp://invalid.example/a");
		expect(result.promptBlock).not.toContain("not-a-url");
	});

	it("caps sources per fact at 4", () => {
		const many = Array.from({ length: 8 }, (_, index) =>
			makeSource({ url: `https://result.example/${index}` }),
		);
		const result = formatPerFactCorroboration([
			makeFact({ id: "f1", sources: many }),
		]);
		expect(result.facts[0].sources).toHaveLength(4);
	});

	it("caps the global deduped source list", () => {
		const facts: FactCorroboration[] = [];
		for (let factIndex = 0; factIndex < 5; factIndex += 1) {
			facts.push(
				makeFact({
					id: `f${factIndex + 1}`,
					sources: Array.from({ length: 4 }, (_, index) =>
						makeSource({ url: `https://result.example/${factIndex}-${index}` }),
					),
				}),
			);
		}
		const result = formatPerFactCorroboration(facts);
		expect(result.allSources).toHaveLength(MAX_TOTAL_RESULTS);
	});

	it("keeps the same source under each fact that returned it but only counts it once in allSources", () => {
		const shared = makeSource({
			url: "https://shared.example/paper",
			title: "Shared Paper",
		});
		const result = formatPerFactCorroboration([
			makeFact({ id: "f1", sources: [shared] }),
			makeFact({
				id: "f2",
				sources: [shared, makeSource({ url: "https://other.example/b" })],
			}),
		]);

		expect(result.facts[0].sources.map((s) => s.url)).toEqual([
			"https://shared.example/paper",
		]);
		expect(result.facts[1].sources.map((s) => s.url)).toEqual([
			"https://shared.example/paper",
			"https://other.example/b",
		]);
		expect(result.allSources.map((s) => s.url)).toEqual([
			"https://shared.example/paper",
			"https://other.example/b",
		]);
	});

	it("marks facts with no sources inline while still surfacing facts with sources", () => {
		const result = formatPerFactCorroboration([
			makeFact({
				id: "f1",
				sources: [makeSource({ url: "https://a.example" })],
			}),
			makeFact({
				id: "f2",
				claim: "Empty fact",
				queries: ["no hits query"],
				sources: [],
			}),
		]);

		expect(result.allSources).toHaveLength(1);
		expect(result.promptBlock).toContain('FACT f2: "Empty fact"');
		expect(result.promptBlock).toContain(
			"- (no public results returned for this fact)",
		);
	});
});
