const FREETSA_URL = "https://freetsa.org/tsr";
const FREETSA_TSA_CERT_URL = "https://freetsa.org/files/tsa.crt";
const FREETSA_CA_CERT_URL = "https://freetsa.org/files/cacert.pem";
const REQUEST_TIMEOUT_MS = 10_000;

export type AnchoredProof = {
	type: "rfc3161-timestamp";
	tsa: string;
	tsaCert: string;
	tsaCaCert: string;
	hashAlgorithm: "SHA-256";
	tokenBase64: string;
	stampedAt: string;
	note: string;
};

export type UnavailableProof = {
	type: "rfc3161-timestamp-unavailable";
	tsa: string;
	note: string;
	attemptedAt: string;
};

export type AnchorResult =
	| { status: "anchored"; proof: AnchoredProof }
	| { status: "unavailable"; proof: UnavailableProof };

export function buildTimestampRequest(digest: Buffer): Buffer {
	if (digest.length !== 32) {
		throw new Error(
			`SHA-256 digest must be 32 bytes, received ${digest.length}`,
		);
	}

	// RFC 3161 TimeStampReq, hand-encoded DER for SHA-256, no nonce, no policy, certReq omitted.
	// Fixed 56-byte structure: 2-byte outer header + 54 bytes of content.
	return Buffer.from([
		0x30,
		0x36, // SEQUENCE, length 54
		0x02,
		0x01,
		0x01, // INTEGER version = 1
		0x30,
		0x31, // SEQUENCE messageImprint, length 49
		0x30,
		0x0d, // SEQUENCE AlgorithmIdentifier, length 13
		0x06,
		0x09,
		0x60,
		0x86,
		0x48,
		0x01,
		0x65,
		0x03,
		0x04,
		0x02,
		0x01, // OID 2.16.840.1.101.3.4.2.1 (SHA-256)
		0x05,
		0x00, // NULL parameters
		0x04,
		0x20, // OCTET STRING, length 32
		...digest,
	]);
}

function unavailable(reason: string): AnchorResult {
	return {
		status: "unavailable",
		proof: {
			type: "rfc3161-timestamp-unavailable",
			tsa: FREETSA_URL,
			note: `FreeTSA timestamp request failed: ${reason}. Manifest hash recorded locally without external attestation.`,
			attemptedAt: new Date().toISOString(),
		},
	};
}

export async function stampManifest(sha256Hex: string): Promise<AnchorResult> {
	let digest: Buffer;
	try {
		digest = Buffer.from(sha256Hex, "hex");
	} catch {
		return unavailable("invalid manifest digest");
	}
	if (digest.length !== 32) {
		return unavailable("invalid manifest digest");
	}

	const tsq = buildTimestampRequest(digest);
	let response: Response;
	try {
		response = await fetch(FREETSA_URL, {
			method: "POST",
			headers: { "Content-Type": "application/timestamp-query" },
			body: new Uint8Array(tsq),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		const reason =
			error instanceof Error && error.name === "TimeoutError"
				? "request timed out"
				: error instanceof Error
					? error.message
					: "network error";
		return unavailable(reason);
	}

	if (!response.ok) {
		return unavailable(`HTTP ${response.status}`);
	}

	let tokenBytes: Buffer;
	try {
		tokenBytes = Buffer.from(await response.arrayBuffer());
	} catch (error) {
		return unavailable(
			error instanceof Error ? error.message : "failed to read response",
		);
	}

	if (tokenBytes.length === 0) {
		return unavailable("empty response body");
	}

	return {
		status: "anchored",
		proof: {
			type: "rfc3161-timestamp",
			tsa: FREETSA_URL,
			tsaCert: FREETSA_TSA_CERT_URL,
			tsaCaCert: FREETSA_CA_CERT_URL,
			hashAlgorithm: "SHA-256",
			tokenBase64: tokenBytes.toString("base64"),
			stampedAt: new Date().toISOString(),
			note: "RFC 3161 timestamp from FreeTSA. Verify with: openssl ts -verify -in token.tsr -digest <hash> -CAfile cacert.pem -untrusted tsa.crt",
		},
	};
}
