import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const validEnv = {
	DATABASE_URL: "postgres://example",
	S3_ENDPOINT: "https://s3.example.com",
	S3_REGION: "us-east-1",
	S3_BUCKET: "evidence",
	S3_ACCESS_KEY_ID: "key",
	S3_SECRET_ACCESS_KEY: "secret",
	OPENAI_API_KEY: "openai",
	FIRECRAWL_API_KEY: "firecrawl",
};

describe("parseServerEnv", () => {
	it("accepts the required server configuration", () => {
		expect(parseServerEnv(validEnv)).toMatchObject(validEnv);
	});

	it("reports missing required fields", () => {
		expect(() => parseServerEnv({ ...validEnv, S3_BUCKET: "" })).toThrow(
			/S3_BUCKET/,
		);
	});
});
