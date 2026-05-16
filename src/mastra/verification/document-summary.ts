import { logger } from "@trigger.dev/sdk/v3";
import * as z from "zod";
import {
	applyPseudonyms,
	buildDictionary,
	type ExtractedEntity,
	extractEntities,
	loadPackageEntities,
	type MergeLogEntry,
	type PackageEntity,
	type PseudonymDictionary,
	resolveEntities,
} from "./pseudonyms";

export const documentSummaryOutputSchema = z.object({
	role: z.string(),
	processingSummary: z.string(),
	publicSafeSynopsis: z.string(),
	signals: z.array(z.string()),
	limitations: z.array(z.string()),
	excerpts: z.array(
		z.object({
			locator: z.string(),
			text: z.string(),
			citationType: z.enum(["excerpt", "paraphrase"]),
		}),
	),
});

export type DocumentSummaryOutput = z.infer<typeof documentSummaryOutputSchema>;

type SummaryAgent = {
	generate: (
		prompt: string,
		options: {
			structuredOutput: { schema: typeof documentSummaryOutputSchema };
		},
	) => Promise<{ object?: DocumentSummaryOutput }>;
};

type SummarizeOptions = {
	entityExtractor?: typeof extractEntities;
	entityResolver?: (
		packageId: string,
		artifactId: string,
		extracted: ExtractedEntity[],
	) => Promise<{ table: PackageEntity[]; newMerges: MergeLogEntry[] }>;
	summaryAgent?: SummaryAgent;
	existingEntitiesLoader?: (packageId: string) => Promise<PackageEntity[]>;
};

function sanitizeSummary(
	data: DocumentSummaryOutput,
	dict: PseudonymDictionary,
): DocumentSummaryOutput {
	return {
		role: applyPseudonyms(data.role, dict),
		processingSummary: applyPseudonyms(data.processingSummary, dict),
		publicSafeSynopsis: applyPseudonyms(data.publicSafeSynopsis, dict),
		signals: data.signals.map((signal) => applyPseudonyms(signal, dict)),
		limitations: data.limitations.map((limitation) =>
			applyPseudonyms(limitation, dict),
		),
		excerpts: data.excerpts.map((excerpt) => ({
			locator: applyPseudonyms(excerpt.locator, dict),
			text: applyPseudonyms(excerpt.text, dict),
			citationType: excerpt.citationType,
		})),
	};
}

export function genericPartialSummary(input: {
	label: string;
	mimeType: string;
	error: string;
}): DocumentSummaryOutput {
	return {
		role: `${input.label} was retained for private review, but no public narrative role was generated.`,
		processingSummary: `${input.mimeType} extraction completed, but entity resolution failed before a public-safe summary could be produced.`,
		publicSafeSynopsis:
			"A public synopsis is withheld for this artifact because entity extraction failed and identity-safe replacement could not be guaranteed.",
		signals: [
			"The artifact remains available to private reviewer agents through hashed extraction records.",
		],
		limitations: [`Public summarization is partial: ${input.error}`],
		excerpts: [],
	};
}

export async function summarizeArtifactWithPseudonyms(
	input: {
		packageId: string;
		artifactId: string;
		label: string;
		mimeType: string;
		sizeBytes: number;
		extractedText: string;
	},
	options: SummarizeOptions = {},
): Promise<
	| {
			ok: true;
			data: DocumentSummaryOutput;
			mergeLog: MergeLogEntry[];
			summaryStatus: "complete" | "partial";
	  }
	| {
			ok: false;
			reason: "summary-failed";
			error: string;
			mergeLog: MergeLogEntry[];
	  }
> {
	const existingEntitiesLoader =
		options.existingEntitiesLoader ?? loadPackageEntities;
	const entityExtractor = options.entityExtractor ?? extractEntities;
	const entityResolver = options.entityResolver ?? resolveEntities;
	const summaryAgent =
		options.summaryAgent ??
		(await import("../agents/document-summary-agent")).documentSummaryAgent;
	const existingTable = await existingEntitiesLoader(input.packageId);

	const extracted = await entityExtractor({
		extractedText: input.extractedText,
		existingTable,
	});

	if (!extracted.ok) {
		return {
			ok: true,
			data: genericPartialSummary({
				label: input.label,
				mimeType: input.mimeType,
				error: extracted.error,
			}),
			mergeLog: [],
			summaryStatus: "partial",
		};
	}

	const resolved = await entityResolver(
		input.packageId,
		input.artifactId,
		extracted.entities,
	);
	const dict = buildDictionary(resolved.table);

	try {
		const dictionaryForPrompt = dict.map((entry) => ({
			kind: entry.kind,
			pseudonym: entry.pseudonym,
			realName: entry.realName,
			variants: entry.variants,
		}));
		logger.info("LLM call start: documentSummaryAgent", {
			packageId: input.packageId,
			artifactId: input.artifactId,
			label: input.label,
			extractedTextChars: input.extractedText.length,
			dictionaryEntries: dict.length,
		});
		const response = await summaryAgent.generate(
			`Summarize this artifact for a public truth certificate.

Artifact:
- label: ${input.label}
- mimeType: ${input.mimeType}
- sizeBytes: ${input.sizeBytes}

Pseudonym dictionary:
${JSON.stringify(dictionaryForPrompt, null, 2)}

Rules:
- Use pseudonyms in every public-facing field.
- Do not emit real names, raw emails, phone numbers, street addresses, SSNs, bank accounts, credit card numbers, or government IDs.
- If the dictionary is missing an identity, use generic roles rather than a real name.
- Keep excerpts short and public-safe.

Extracted text:
${input.extractedText.slice(0, 12000)}`,
			{ structuredOutput: { schema: documentSummaryOutputSchema } },
		);

		if (!response.object) {
			throw new Error("Document summary agent returned no structured object.");
		}

		logger.info("LLM call complete: documentSummaryAgent", {
			packageId: input.packageId,
			artifactId: input.artifactId,
			usage: "usage" in response ? response.usage : undefined,
		});
		return {
			ok: true,
			data: sanitizeSummary(response.object, dict),
			mergeLog: resolved.newMerges,
			summaryStatus: "complete",
		};
	} catch (error) {
		logger.error("LLM call failed: documentSummaryAgent", {
			packageId: input.packageId,
			artifactId: input.artifactId,
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			ok: false,
			reason: "summary-failed",
			error:
				error instanceof Error
					? error.message
					: "Unknown document summary error",
			mergeLog: resolved.newMerges,
		};
	}
}
