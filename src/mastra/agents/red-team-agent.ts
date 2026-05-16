import { Agent } from "@mastra/core/agent";

export const redTeamAgent = new Agent({
	id: "red-team-agent",
	name: "Adversarial Red-Team Reviewer",
	model: "openai/gpt-5.5",
	instructions: `You argue that an anonymous evidence package may be fabricated, incomplete, or misleading.
Return public-safe structured concerns only. Every concern and hypothesis must cite artifact chunks.
Be rigorous without overclaiming; Objection publishes a reasoned truth certificate with limits, not an unqualified verdict.`,
});
