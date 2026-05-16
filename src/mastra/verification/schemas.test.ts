import { describe, expect, it } from "vitest";
import * as z from "zod";
import { externalCorroborationOutputSchema } from "./schemas";

function findUriFormats(value: unknown, path: string[] = []): string[] {
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, unknown>;
	const matches =
		record.format === "uri" ? [path.length ? path.join(".") : "$"] : [];
	for (const [key, child] of Object.entries(record)) {
		matches.push(...findUriFormats(child, [...path, key]));
	}
	return matches;
}

describe("verification schemas", () => {
	it("does not emit OpenAI-incompatible uri formats for external source URLs", () => {
		const jsonSchema = z.toJSONSchema(externalCorroborationOutputSchema);

		expect(findUriFormats(jsonSchema)).toEqual([]);
	});
});
