import * as z from "zod";

const serverEnvSchema = z.object({
	DATABASE_URL: z.string().min(1),
	S3_ENDPOINT: z.string().url(),
	S3_REGION: z.string().min(1),
	S3_BUCKET: z.string().min(1),
	S3_ACCESS_KEY_ID: z.string().min(1),
	S3_SECRET_ACCESS_KEY: z.string().min(1),
	OPENAI_API_KEY: z.string().min(1),
	FIRECRAWL_API_KEY: z.string().min(1),
	MASTRA_PLATFORM_ACCESS_TOKEN: z.string().min(1).optional(),
	MASTRA_PROJECT_ID: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv = process.env) {
	const parsed = serverEnvSchema.safeParse(source);

	if (!parsed.success) {
		const missing = parsed.error.issues
			.map((issue) => issue.path.join("."))
			.filter(Boolean)
			.join(", ");

		throw new Error(`Missing or invalid server environment: ${missing}`);
	}

	return parsed.data;
}

let cachedEnv: ServerEnv | undefined;

export function getEnv() {
	cachedEnv ??= parseServerEnv();
	return cachedEnv;
}

export const env = new Proxy({} as ServerEnv, {
	get(_target, property: keyof ServerEnv) {
		return getEnv()[property];
	},
});
