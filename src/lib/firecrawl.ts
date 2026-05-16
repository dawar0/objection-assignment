import Firecrawl from "@mendable/firecrawl-js";
import { env } from "../env";
import {
	type ExternalSource,
	sanitizeExternalSources,
} from "../mastra/verification/schemas";

let client: Firecrawl | undefined;

function firecrawl() {
	client ??= new Firecrawl({ apiKey: env.FIRECRAWL_API_KEY });
	return client;
}

export async function searchExternalSources(
	query: string,
): Promise<ExternalSource[]> {
	const accessedAt = new Date().toISOString();
	const response = await firecrawl().search(query, { limit: 5 });
	const web = (response.web ?? []) as Array<{
		url?: string;
		title?: string;
		description?: string;
		markdown?: string;
	}>;

	return sanitizeExternalSources(
		web
			.filter(
				(result): result is typeof result & { url: string } =>
					typeof result.url === "string",
			)
			.slice(0, 5)
			.map((result) => ({
				url: result.url,
				title: result.title || result.url,
				snippet:
					result.description ||
					result.markdown?.slice(0, 300) ||
					"No snippet returned.",
				accessedAt,
			})),
	);
}
