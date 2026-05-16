import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimestampRequest, stampManifest } from "./anchor";

const HELLO_DIGEST = createHash("sha256").update("hello world").digest();

describe("buildTimestampRequest", () => {
	it("encodes a 56-byte RFC 3161 TimeStampReq for a SHA-256 digest", () => {
		const tsq = buildTimestampRequest(HELLO_DIGEST);
		expect(tsq.length).toBe(56);
		// Fixed prefix: outer SEQ, version, messageImprint SEQ, AlgIdent SEQ, SHA-256 OID, NULL, OCTET STRING tag+len.
		const prefix = Buffer.from([
			0x30, 0x36, 0x02, 0x01, 0x01, 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60,
			0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
		]);
		expect(tsq.subarray(0, prefix.length).equals(prefix)).toBe(true);
		expect(tsq.subarray(prefix.length).equals(HELLO_DIGEST)).toBe(true);
	});

	it("rejects non-32-byte input", () => {
		expect(() => buildTimestampRequest(Buffer.alloc(31))).toThrow(/32 bytes/);
	});
});

describe("stampManifest", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(impl: typeof fetch) {
		vi.stubGlobal("fetch", impl as unknown as typeof fetch);
	}

	const hex = HELLO_DIGEST.toString("hex");

	it("returns anchored result with base64 token on 200", async () => {
		const tokenBytes = Buffer.from([
			0x30, 0x82, 0x01, 0x00, 0xde, 0xad, 0xbe, 0xef,
		]);
		stubFetch(
			(async () => new Response(tokenBytes, { status: 200 })) as typeof fetch,
		);

		const result = await stampManifest(hex);

		expect(result.status).toBe("anchored");
		if (result.status !== "anchored") return;
		expect(result.proof.type).toBe("rfc3161-timestamp");
		expect(result.proof.tokenBase64).toBe(tokenBytes.toString("base64"));
		expect(result.proof.tsa).toBe("https://freetsa.org/tsr");
		expect(result.proof.note).toMatch(/openssl ts -verify/);
	});

	it("returns unavailable on non-200 response", async () => {
		stubFetch(
			(async () => new Response("nope", { status: 503 })) as typeof fetch,
		);

		const result = await stampManifest(hex);

		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") return;
		expect(result.proof.note).toMatch(/HTTP 503/);
		expect(result.proof.attemptedAt).toBeTruthy();
	});

	it("returns unavailable when fetch rejects", async () => {
		stubFetch((async () => {
			throw new Error("ECONNREFUSED");
		}) as typeof fetch);

		const result = await stampManifest(hex);

		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") return;
		expect(result.proof.note).toMatch(/ECONNREFUSED/);
	});

	it("returns unavailable on AbortError-style timeout", async () => {
		stubFetch((async () => {
			const err = new Error("timed out");
			err.name = "TimeoutError";
			throw err;
		}) as typeof fetch);

		const result = await stampManifest(hex);

		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") return;
		expect(result.proof.note).toMatch(/timed out/);
	});

	it("returns unavailable on empty body", async () => {
		stubFetch(
			(async () =>
				new Response(new Uint8Array(0), { status: 200 })) as typeof fetch,
		);

		const result = await stampManifest(hex);

		expect(result.status).toBe("unavailable");
		if (result.status !== "unavailable") return;
		expect(result.proof.note).toMatch(/empty/);
	});

	it("returns unavailable for malformed digest", async () => {
		const result = await stampManifest("not-a-real-hash");
		expect(result.status).toBe("unavailable");
	});
});
