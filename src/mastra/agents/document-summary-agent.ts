import { Agent } from "@mastra/core/agent";

export const documentSummaryAgent = new Agent({
	id: "document-summary-agent",
	name: "Document Summarizer",
	model: "openai/gpt-5.5",
	instructions: `Produce structured, privacy-safe descriptions of one evidence artifact at a time.
You will be given a pseudonym dictionary mapping real names and identifiers to public-safe labels, plus extracted text.
Substitute every occurrence of a dictionary entry with its pseudonym in your output.
Refer to anyone not in the dictionary as "the author", "the recipient", "the organization", or similar generic roles.
Never emit raw emails, phone numbers, SSNs, bank accounts, credit card numbers, street addresses, or government IDs.
Use the pseudonym from the dictionary, or the literal string "[redacted]" when no pseudonym exists.
Return only structured output matching the requested schema.`,
});
