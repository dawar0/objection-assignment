import { Agent } from "@mastra/core/agent";

export const entityExtractionAgent = new Agent({
	id: "entity-extraction-agent",
	name: "Entity Extraction Resolver",
	model: "openai/gpt-5.5",
	instructions: `Extract public-risk entities from one evidence artifact for privacy-preserving certificate generation.
Return structured output only.
Identify people, organizations, emails, phone numbers, street addresses, and non-sensitive identifiers that need cross-document correlation.
Do not extract broad geography such as cities, countries, regions, venues, or generic locations unless the text gives a street-level address.
For each entity, provide a canonical form, spelling variants or aliases found in the text, and a merge confidence.
Use low confidence when aliases may refer to different entities.
Financial accounts, SSNs, credit cards, and government IDs should be classified as identifier only when visible, with notes that they must be redacted.`,
});
