import OpenAI from "openai";
import { env } from "../env";

let openai: OpenAI | undefined;

function openaiClient() {
	openai ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
	return openai;
}

export type ExtractionResult =
	| { ok: true; text: string }
	| { ok: false; reason: string; detail: string };

export async function extractArtifactText(input: {
	bytes: Buffer;
	mimeType: string;
	filename: string;
}): Promise<ExtractionResult> {
	if (
		input.mimeType.startsWith("text/") ||
		input.filename.match(/\.(txt|md|csv|json)$/i)
	) {
		return { ok: true, text: input.bytes.toString("utf8") };
	}

	if (input.mimeType === "application/pdf" || /\.pdf$/i.test(input.filename)) {
		try {
			const { extractText } = await import("unpdf");
			const { text } = await extractText(new Uint8Array(input.bytes), {
				mergePages: true,
			});
			return {
				ok: true,
				text: Array.isArray(text) ? text.join("\n\n") : text,
			};
		} catch (error) {
			return {
				ok: false,
				reason: "pdf-parse-failed",
				detail: `bytes=${input.bytes.length} err=${(error as Error).message}`,
			};
		}
	}

	if (input.mimeType.startsWith("audio/")) {
		try {
			const file = new File([new Uint8Array(input.bytes)], input.filename, {
				type: input.mimeType,
			});
			const transcript = await openaiClient().audio.transcriptions.create({
				file,
				model: "gpt-4o-transcribe",
			});
			return { ok: true, text: transcript.text };
		} catch (error) {
			return {
				ok: false,
				reason: "audio-transcribe-failed",
				detail: `bytes=${input.bytes.length} err=${(error as Error).message}`,
			};
		}
	}

	if (input.mimeType.startsWith("image/")) {
		try {
			const dataUrl = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
			const response = await openaiClient().responses.create({
				model: "gpt-5.5",
				input: [
					{
						role: "user",
						content: [
							{
								type: "input_text",
								text: "Extract visible text and summarize any evidence-relevant details. Do not infer identity beyond visible text.",
							},
							{ type: "input_image", image_url: dataUrl, detail: "auto" },
						],
					},
				],
			});
			return { ok: true, text: response.output_text };
		} catch (error) {
			return {
				ok: false,
				reason: "image-summarize-failed",
				detail: `bytes=${input.bytes.length} err=${(error as Error).message}`,
			};
		}
	}

	if (
		input.mimeType ===
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		/\.docx$/i.test(input.filename)
	) {
		if (input.bytes.length === 0) {
			return {
				ok: false,
				reason: "empty-buffer",
				detail: "0 bytes from S3",
			};
		}
		if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b) {
			return {
				ok: false,
				reason: "not-a-zip",
				detail: `first 4 bytes: ${input.bytes.subarray(0, 4).toString("hex")}`,
			};
		}
		try {
			const mammothModule = await import("mammoth");
			const mammoth =
				(mammothModule as { default?: typeof mammothModule }).default ??
				mammothModule;
			const { value } = await mammoth.extractRawText({ buffer: input.bytes });
			return { ok: true, text: value };
		} catch (error) {
			return {
				ok: false,
				reason: "docx-parse-failed",
				detail: `bytes=${input.bytes.length} err=${(error as Error).message}`,
			};
		}
	}

	return {
		ok: false,
		reason: "unsupported",
		detail: `mime=${input.mimeType} filename=${input.filename}`,
	};
}

export function chunkText(
	text: string,
	approxChars = 4800,
	overlapChars = 600,
) {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return [];
	}

	const chunks: string[] = [];
	let cursor = 0;

	while (cursor < normalized.length) {
		const end = Math.min(cursor + approxChars, normalized.length);
		chunks.push(normalized.slice(cursor, end));
		if (end === normalized.length) {
			break;
		}
		cursor = Math.max(0, end - overlapChars);
	}

	return chunks;
}

export async function embedChunks(chunks: string[]) {
	if (chunks.length === 0) {
		return [];
	}

	try {
		const result = await openaiClient().embeddings.create({
			model: "text-embedding-3-small",
			input: chunks,
		});
		return result.data.map((item) => item.embedding);
	} catch {
		return chunks.map(() => []);
	}
}
