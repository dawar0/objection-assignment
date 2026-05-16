import { logger } from "@trigger.dev/sdk/v3";
import OpenAI from "openai";
import { env } from "../env";
import {
	type ExternalSource,
	sanitizeExternalSources,
} from "../mastra/verification/schemas";
import { searchExternalSources } from "./firecrawl";

let openai: OpenAI | undefined;

function openaiClient() {
	openai ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
	return openai;
}

const FACT_EXTRACTION_MODEL = "gpt-4o-mini";
const MAX_FACTS = 6;
const MAX_QUERIES_PER_FACT = 3;
const MAX_SOURCES_PER_FACT = 4;
export const MAX_TOTAL_RESULTS = 12;

export const EMPTY_CORROBORATION_PROMPT_BLOCK =
	"No public sources supplied during Objection evidence finalization.";

const FACT_EXTRACTION_SYSTEM = `You decompose an Objection evidence package into discrete public-checkable facts.

Output strictly valid JSON of shape:
{ "facts": [ { "claim": string, "queries": string[] } ] }

Rules:
- Each fact is a single public-checkable statement about a PUBLIC entity (named institution, published paper, registered grant, public person in their professional capacity, official record, news coverage).
- 1-3 search queries per fact, each 3-10 words, self-contained, suitable for a generic web search and targeted at THIS fact specifically.
- NEVER include source-identifying details: no case handler names, no internal workspace IDs, no quotes that uniquely fingerprint the source, no personal contact info.
- Prefer facts that could be independently corroborated by peer-reviewed papers, institutional pages, regulatory filings, or prior news.
- Return at most 6 facts. If the package is too thin to support real public-checkable facts, return { "facts": [] }.`;

export type PublicFactCandidate = {
	id: string;
	claim: string;
	queries: string[];
};

export async function extractPublicFacts(
	artifactContext: string,
): Promise<PublicFactCandidate[]> {
	try {
		logger.info("LLM call start: public fact extraction", {
			model: FACT_EXTRACTION_MODEL,
			artifactContextChars: artifactContext.length,
		});
		const completion = await openaiClient().chat.completions.create({
			model: FACT_EXTRACTION_MODEL,
			response_format: { type: "json_object" },
			temperature: 0.2,
			messages: [
				{ role: "system", content: FACT_EXTRACTION_SYSTEM },
				{
					role: "user",
					content: `ARTIFACT CONTEXT:\n${artifactContext.slice(0, 12_000)}`,
				},
			],
		});

		const raw = completion.choices[0]?.message?.content ?? "{}";
		logger.info("LLM call complete: public fact extraction", {
			model: FACT_EXTRACTION_MODEL,
			usage: completion.usage,
			finishReason: completion.choices[0]?.finish_reason,
		});
		const parsed = JSON.parse(raw) as { facts?: unknown };
		if (!Array.isArray(parsed.facts)) {
			return [];
		}

		const facts: PublicFactCandidate[] = [];
		for (const item of parsed.facts) {
			if (!item || typeof item !== "object") continue;
			const record = item as { claim?: unknown; queries?: unknown };
			const claim = typeof record.claim === "string" ? record.claim.trim() : "";
			if (!claim) continue;
			const queries = Array.isArray(record.queries)
				? record.queries
						.filter(
							(q): q is string => typeof q === "string" && q.trim().length > 0,
						)
						.map((q) => q.trim())
						.slice(0, MAX_QUERIES_PER_FACT)
				: [];
			if (queries.length === 0) continue;
			facts.push({ id: `f${facts.length + 1}`, claim, queries });
			if (facts.length >= MAX_FACTS) break;
		}
		return facts;
	} catch (error) {
		logger.error("LLM call failed: public fact extraction", {
			model: FACT_EXTRACTION_MODEL,
			error: error instanceof Error ? error.message : String(error),
		});
		throw new Error(
			error instanceof Error ? error.message : "Public fact extraction failed.",
		);
	}
}

export type FactCorroboration = {
	id: string;
	claim: string;
	queries: string[];
	sources: ExternalSource[];
};

export type PerFactCorroboration = {
	status: "complete" | "degraded";
	facts: FactCorroboration[];
	allSources: ExternalSource[];
	promptBlock: string;
	failureReason?: string;
};

const EMPTY_PER_FACT: PerFactCorroboration = {
	status: "complete",
	facts: [],
	allSources: [],
	promptBlock: EMPTY_CORROBORATION_PROMPT_BLOCK,
};

export function formatPerFactCorroboration(
	facts: FactCorroboration[],
	options: { maxTotalResults?: number } = {},
): PerFactCorroboration {
	const maxTotalResults = options.maxTotalResults ?? MAX_TOTAL_RESULTS;

	if (facts.length === 0) {
		return EMPTY_PER_FACT;
	}

	const seenGlobal = new Set<string>();
	const allSources: ExternalSource[] = [];
	const trimmedFacts: FactCorroboration[] = [];

	for (const fact of facts) {
		const seenLocal = new Set<string>();
		const factSources: ExternalSource[] = [];
		for (const source of sanitizeExternalSources(fact.sources)) {
			if (factSources.length >= MAX_SOURCES_PER_FACT) break;
			if (seenLocal.has(source.url)) continue;
			seenLocal.add(source.url);
			factSources.push(source);
			if (!seenGlobal.has(source.url) && allSources.length < maxTotalResults) {
				seenGlobal.add(source.url);
				allSources.push(source);
			}
		}
		trimmedFacts.push({ ...fact, sources: factSources });
	}

	const blocks = trimmedFacts.map((fact) => {
		const queryLine = `Queries: ${fact.queries.map((q) => `"${q}"`).join(", ")}`;
		const sourceLines = fact.sources.length
			? fact.sources
					.map(
						(source) =>
							`- ${source.title} (${source.url})\n  ${source.snippet}`,
					)
					.join("\n")
			: "- (no public results returned for this fact)";
		return `FACT ${fact.id}: "${fact.claim}"\n${queryLine}\nSources:\n${sourceLines}`;
	});

	return {
		status: "complete",
		facts: trimmedFacts,
		allSources,
		promptBlock: blocks.join("\n\n"),
	};
}

export async function gatherPerFactCorroboration(
	artifactContext: string,
): Promise<PerFactCorroboration> {
	try {
		const candidates = await extractPublicFacts(artifactContext);
		if (candidates.length === 0) {
			return EMPTY_PER_FACT;
		}

		const facts = await Promise.all(
			candidates.map(async (candidate): Promise<FactCorroboration> => {
				const perQuery = await Promise.all(
					candidate.queries.map(async (query) => {
						try {
							return await searchExternalSources(query);
						} catch {
							return [] as ExternalSource[];
						}
					}),
				);
				const sources: ExternalSource[] = [];
				const seen = new Set<string>();
				for (const results of perQuery) {
					for (const result of results) {
						if (seen.has(result.url)) continue;
						seen.add(result.url);
						sources.push(result);
					}
				}
				return {
					id: candidate.id,
					claim: candidate.claim,
					queries: candidate.queries,
					sources,
				};
			}),
		);

		return formatPerFactCorroboration(facts);
	} catch (error) {
		return {
			...EMPTY_PER_FACT,
			status: "degraded",
			failureReason:
				error instanceof Error
					? error.message
					: "Unknown public fact extraction failure.",
		};
	}
}
