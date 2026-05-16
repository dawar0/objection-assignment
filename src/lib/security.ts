import { createHash, randomBytes } from "node:crypto";

export function createCapabilityToken() {
	return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

export function sha256(input: Buffer | string) {
	return createHash("sha256").update(input).digest("hex");
}

export function publicId(prefix: string) {
	return `${prefix}_${randomBytes(9).toString("base64url")}`;
}
