import { logger } from "@trigger.dev/sdk/v3";
import * as z from "zod";

export const entityKindSchema = z.enum([
	"person",
	"org",
	"place",
	"email",
	"phone",
	"address",
	"identifier",
]);
export const mergeConfidenceSchema = z.enum(["low", "medium", "high"]);

export type EntityKind = z.infer<typeof entityKindSchema>;
export type MergeConfidence = z.infer<typeof mergeConfidenceSchema>;
export type PackageEntity = {
	id: string;
	packageId: string;
	kind: string;
	realName: string;
	pseudonym: string;
	variants: string[];
	firstSeenArtifactId: string | null;
	mergeConfidence: string;
	mergeNotes: string | null;
	createdAt: Date;
};

export const entityExtractionOutputSchema = z.object({
	entities: z.array(
		z.object({
			kind: entityKindSchema,
			canonical: z.string().min(1),
			variants: z.array(z.string().min(1)).default([]),
			mergeConfidence: mergeConfidenceSchema,
			mergeNotes: z.string().optional(),
		}),
	),
});

export type ExtractedEntity = z.infer<
	typeof entityExtractionOutputSchema
>["entities"][number];

export type MergeLogEntry = {
	artifactId: string;
	kind: EntityKind;
	canonical: string;
	pseudonym: string;
	action: "created" | "merged" | "redacted";
	mergeConfidence: MergeConfidence;
	mergeNotes?: string;
};

export type PseudonymDictionaryEntry = {
	kind: EntityKind;
	realName: string;
	pseudonym: string;
	variants: string[];
};

export type PseudonymDictionary = PseudonymDictionaryEntry[];

type EntityExtractionAgent = {
	generate: (
		prompt: string,
		options: {
			structuredOutput: { schema: typeof entityExtractionOutputSchema };
		},
	) => Promise<{ object?: z.infer<typeof entityExtractionOutputSchema> }>;
};

const greekLabels = [
	"α",
	"β",
	"γ",
	"δ",
	"ε",
	"ζ",
	"η",
	"θ",
	"ι",
	"κ",
	"λ",
	"μ",
	"ν",
	"ξ",
	"ο",
	"π",
	"ρ",
	"σ",
	"τ",
	"υ",
	"φ",
	"χ",
	"ψ",
	"ω",
];

const kindLabels: Record<EntityKind, string> = {
	person: "Person",
	org: "Org",
	place: "Place",
	email: "Email",
	phone: "Phone",
	address: "Address",
	identifier: "Identifier",
};

async function databaseContext() {
	const [{ db }, { packageEntities }, { and, eq }] = await Promise.all([
		import("../../db"),
		import("../../db/schema"),
		import("drizzle-orm"),
	]);
	return { and, db, eq, packageEntities };
}

function latinLabel(index: number) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	if (index < alphabet.length) {
		return alphabet[index] ?? "A";
	}
	const first = Math.floor((index - alphabet.length) / alphabet.length);
	const second = (index - alphabet.length) % alphabet.length;
	return `${alphabet[first] ?? "A"}${alphabet[second] ?? "A"}`;
}

export function nextPseudonym(kind: EntityKind, existingCount: number): string {
	if (kind === "person") {
		return `Person ${latinLabel(existingCount)}`;
	}

	const suffix =
		existingCount < greekLabels.length
			? greekLabels[existingCount]
			: latinLabel(existingCount - greekLabels.length + 26);
	return `${kindLabels[kind]} ${suffix}`;
}

function normalize(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueValues(values: string[]) {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values.map((item) => item.trim()).filter(Boolean)) {
		const key = normalize(value);
		if (!seen.has(key)) {
			seen.add(key);
			output.push(value);
		}
	}
	return output;
}

function allEntityNames(entity: ExtractedEntity) {
	return uniqueValues([entity.canonical, ...entity.variants]);
}

function isSensitiveIdentifier(entity: ExtractedEntity) {
	if (entity.kind !== "identifier") {
		return false;
	}
	const text = allEntityNames(entity).join(" ");
	return (
		/\b\d{3}-\d{2}-\d{4}\b/.test(text) ||
		/\b(?:\d[ -]*?){13,19}\b/.test(text) ||
		/\b(?:account|acct|routing|passport|driver|license|taxpayer|tin)\b/i.test(
			text,
		)
	);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function piiSweep(text: string) {
	return text
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
		.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted]")
		.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
			const digits = match.replace(/\D/g, "");
			return digits.length >= 13 && digits.length <= 19 ? "[redacted]" : match;
		})
		.replace(
			/(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g,
			"[redacted]",
		);
}

export function applyPseudonyms(
	text: string,
	dict: PseudonymDictionary,
): string {
	let output = text;
	const replacements = dict
		.flatMap((entry) =>
			uniqueValues([entry.realName, ...entry.variants])
				.filter((value) => value.length > 1)
				.map((value) => ({ value, pseudonym: entry.pseudonym })),
		)
		.sort((left, right) => right.value.length - left.value.length);

	for (const replacement of replacements) {
		const pattern = new RegExp(
			`(?<![\\p{L}\\p{N}_])${escapeRegExp(replacement.value)}(?![\\p{L}\\p{N}_])`,
			"giu",
		);
		output = output.replace(pattern, replacement.pseudonym);
	}

	return piiSweep(output);
}

export function buildDictionary(table: PackageEntity[]): PseudonymDictionary {
	return table.map((entity) => ({
		kind: entity.kind as EntityKind,
		realName: entity.realName,
		pseudonym: entity.pseudonym,
		variants: entity.variants,
	}));
}

export async function extractEntities(input: {
	extractedText: string;
	existingTable: PackageEntity[];
	agent?: EntityExtractionAgent;
}): Promise<
	{ ok: true; entities: ExtractedEntity[] } | { ok: false; error: string }
> {
	try {
		const agent =
			input.agent ??
			(await import("../agents/entity-extraction-agent")).entityExtractionAgent;
		const existing = input.existingTable
			.map(
				(entity) =>
					`${entity.kind}: ${entity.realName} (${entity.pseudonym}); variants: ${entity.variants.join(", ")}`,
			)
			.join("\n");
		logger.info("LLM call start: entityExtractionAgent", {
			existingEntityCount: input.existingTable.length,
			extractedTextChars: input.extractedText.length,
		});
		const response = await agent.generate(
			`Extract entities that need pseudonymization from this artifact.

Existing package dictionary:
${existing || "(none yet)"}

Return only entities visible in this artifact. Do not include broad place names unless they are street-level addresses.

Artifact text:
${input.extractedText.slice(0, 12000)}`,
			{ structuredOutput: { schema: entityExtractionOutputSchema } },
		);
		const entities: ExtractedEntity[] = (response.object?.entities ?? []).map(
			(entity) => ({ ...entity, variants: entity.variants ?? [] }),
		);
		logger.info("LLM call complete: entityExtractionAgent", {
			entityCount: entities.length,
			usage: "usage" in response ? response.usage : undefined,
		});
		return { ok: true, entities };
	} catch (error) {
		logger.error("LLM call failed: entityExtractionAgent", {
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Unknown entity extraction error",
		};
	}
}

function findExistingMatch(entity: ExtractedEntity, existing: PackageEntity[]) {
	const names = new Set(allEntityNames(entity).map(normalize));
	return existing.find((row) => {
		if (row.kind !== entity.kind) {
			return false;
		}
		const rowNames = [row.realName, ...row.variants].map(normalize);
		return rowNames.some((name) => names.has(name));
	});
}

export function findMatchingPackageEntity(
	entity: ExtractedEntity,
	existing: PackageEntity[],
) {
	return findExistingMatch(entity, existing);
}

export async function resolveEntities(
	packageId: string,
	artifactId: string,
	extracted: ExtractedEntity[],
): Promise<{ table: PackageEntity[]; newMerges: MergeLogEntry[] }> {
	const { db, eq, packageEntities } = await databaseContext();
	let table = await db
		.select()
		.from(packageEntities)
		.where(eq(packageEntities.packageId, packageId));
	const mergeLog: MergeLogEntry[] = [];

	for (const entity of extracted) {
		if (isSensitiveIdentifier(entity)) {
			mergeLog.push({
				artifactId,
				kind: entity.kind,
				canonical: entity.canonical,
				pseudonym: "[redacted]",
				action: "redacted",
				mergeConfidence: entity.mergeConfidence,
				mergeNotes: entity.mergeNotes,
			});
			continue;
		}

		const match = findExistingMatch(entity, table);
		const entityNames = allEntityNames(entity);

		if (match) {
			const variants = uniqueValues([...match.variants, ...entityNames]);
			const [updated] = await db
				.update(packageEntities)
				.set({
					variants,
					mergeConfidence:
						match.mergeConfidence === "low" || entity.mergeConfidence === "low"
							? "low"
							: match.mergeConfidence === "medium" ||
									entity.mergeConfidence === "medium"
								? "medium"
								: "high",
					mergeNotes: uniqueValues([
						match.mergeNotes ?? "",
						entity.mergeNotes ?? "",
					]).join(" "),
				})
				.where(eq(packageEntities.id, match.id))
				.returning();
			table = table.map((row) => (row.id === match.id ? updated : row));
			mergeLog.push({
				artifactId,
				kind: entity.kind,
				canonical: entity.canonical,
				pseudonym: match.pseudonym,
				action: "merged",
				mergeConfidence: entity.mergeConfidence,
				mergeNotes: entity.mergeNotes,
			});
			continue;
		}

		const sameKindCount = table.filter(
			(row) => row.kind === entity.kind,
		).length;
		const [created] = await db
			.insert(packageEntities)
			.values({
				packageId,
				kind: entity.kind,
				realName: entity.canonical,
				pseudonym: nextPseudonym(entity.kind, sameKindCount),
				variants: entityNames,
				firstSeenArtifactId: artifactId,
				mergeConfidence: entity.mergeConfidence,
				mergeNotes: entity.mergeNotes,
			})
			.returning();
		table = [...table, created];
		mergeLog.push({
			artifactId,
			kind: entity.kind,
			canonical: entity.canonical,
			pseudonym: created.pseudonym,
			action: "created",
			mergeConfidence: entity.mergeConfidence,
			mergeNotes: entity.mergeNotes,
		});
	}

	return { table, newMerges: mergeLog };
}

export async function loadPackageDictionary(packageId: string) {
	const { db, eq, packageEntities } = await databaseContext();
	const rows = await db
		.select()
		.from(packageEntities)
		.where(eq(packageEntities.packageId, packageId));
	return buildDictionary(rows);
}

export function findDictionaryMatches(text: string, dict: PseudonymDictionary) {
	const matches = new Set<string>();
	for (const entry of dict) {
		for (const value of uniqueValues([
			entry.realName,
			...entry.variants,
		]).filter((item) => item.length > 1)) {
			const pattern = new RegExp(
				`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`,
				"iu",
			);
			if (pattern.test(text)) {
				matches.add(value);
			}
		}
	}
	return [...matches];
}

export function sweepPublicStrings<T>(
	value: T,
	dict: PseudonymDictionary,
): { value: T; residualMatches: string[] } {
	const residualMatches = new Set<string>();

	function visit(input: unknown): unknown {
		if (typeof input === "string") {
			for (const match of findDictionaryMatches(input, dict)) {
				residualMatches.add(match);
			}
			return applyPseudonyms(input, dict);
		}

		if (Array.isArray(input)) {
			return input.map(visit);
		}

		if (input && typeof input === "object") {
			return Object.fromEntries(
				Object.entries(input).map(([key, child]) => [key, visit(child)]),
			);
		}

		return input;
	}

	return { value: visit(value) as T, residualMatches: [...residualMatches] };
}

export async function deletePackageEntities(packageId: string) {
	const { db, eq, packageEntities } = await databaseContext();
	await db
		.delete(packageEntities)
		.where(eq(packageEntities.packageId, packageId));
}

export async function loadPackageEntities(packageId: string) {
	const { db, eq, packageEntities } = await databaseContext();
	return db
		.select()
		.from(packageEntities)
		.where(eq(packageEntities.packageId, packageId));
}

export async function entityExistsForPackage(
	packageId: string,
	kind: EntityKind,
	realName: string,
) {
	const { and, db, eq, packageEntities } = await databaseContext();
	const [row] = await db
		.select({ id: packageEntities.id })
		.from(packageEntities)
		.where(
			and(
				eq(packageEntities.packageId, packageId),
				eq(packageEntities.kind, kind),
				eq(packageEntities.realName, realName),
			),
		)
		.limit(1);
	return Boolean(row);
}
