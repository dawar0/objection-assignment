import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";

let client: S3Client | undefined;

export function s3Client() {
	client ??= new S3Client({
		region: env.S3_REGION,
		endpoint: env.S3_ENDPOINT,
		forcePathStyle: true,
		credentials: {
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		},
	});

	return client;
}

export async function createPresignedPutUrl(input: {
	key: string;
	contentType: string;
	contentLength?: number;
}) {
	const command = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: input.key,
		ContentType: input.contentType,
		ContentLength: input.contentLength,
	});

	return getSignedUrl(s3Client(), command, { expiresIn: 60 * 10 });
}

export async function headEvidenceObject(key: string) {
	return s3Client().send(
		new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
	);
}

export async function readEvidenceObject(key: string) {
	const result = await s3Client().send(
		new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
	);
	const chunks: Uint8Array[] = [];

	if (!result.Body) {
		throw new Error(`S3 object ${key} has no body`);
	}

	for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
		chunks.push(chunk);
	}

	return Buffer.concat(chunks);
}

export async function deleteEvidenceObjects(keys: string[]) {
	const uniqueKeys = [...new Set(keys.filter(Boolean))];
	if (uniqueKeys.length === 0) {
		return;
	}

	for (let index = 0; index < uniqueKeys.length; index += 1000) {
		const batch = uniqueKeys.slice(index, index + 1000);
		const result = await s3Client().send(
			new DeleteObjectsCommand({
				Bucket: env.S3_BUCKET,
				Delete: {
					Objects: batch.map((key) => ({ Key: key })),
					Quiet: true,
				},
			}),
		);

		if (result.Errors?.length) {
			const failedKeys = result.Errors.map((error) => error.Key)
				.filter(Boolean)
				.join(", ");
			throw new Error(
				`Failed to delete uploaded evidence objects${failedKeys ? `: ${failedKeys}` : ""}`,
			);
		}
	}
}
