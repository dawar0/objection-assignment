import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Check, CheckCircle2, Copy, Loader2, UploadCloud } from "lucide-react";
import { useState } from "react";
import * as z from "zod";
import { Button } from "#/components/ui/button";

const createSlotsFn = createServerFn({ method: "POST" })
	.inputValidator(
		z.object({
			token: z.string(),
			files: z.array(
				z.object({
					filename: z.string(),
					contentType: z.string(),
					sizeBytes: z.number(),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const { createUploadSlots } = await import("../lib/intake");
		return createUploadSlots(data);
	});

const finalizeFn = createServerFn({ method: "POST" })
	.inputValidator(z.object({ token: z.string() }))
	.handler(async ({ data }) => {
		const { finalizeIntake } = await import("../lib/intake");
		return finalizeIntake(data.token);
	});

export const Route = createFileRoute("/source/$token")({
	component: SourceUploadPage,
});

function CopyValueButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label={label}
			className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={async () => {
				await navigator.clipboard.writeText(value);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1400);
			}}
		>
			{copied ? (
				<Check size={14} className="text-chart-5" />
			) : (
				<Copy size={14} />
			)}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

function SourceUploadPage() {
	const { token } = Route.useParams();
	const [files, setFiles] = useState<File[]>([]);
	const [status, setStatus] = useState("Waiting for files");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [submitted, setSubmitted] = useState<{
		pseudonym: string;
		packageId: string;
	}>();

	async function upload() {
		if (files.length === 0) {
			setError("Choose at least one file.");
			return;
		}

		setBusy(true);
		setError(undefined);
		try {
			setStatus("Creating signed upload URLs");
			const { slots } = await createSlotsFn({
				data: {
					token,
					files: files.map((file) => ({
						filename: file.name,
						contentType: file.type || "application/octet-stream",
						sizeBytes: file.size,
					})),
				},
			});

			for (const [index, slot] of slots.entries()) {
				const file = files[index];
				setStatus(`Uploading ${file.name}`);
				const response = await fetch(slot.url, {
					method: "PUT",
					headers: { "content-type": file.type || "application/octet-stream" },
					body: file,
				});

				if (!response.ok) {
					throw new Error(`Upload failed for ${file.name}`);
				}
			}

			setStatus("Finalizing evidence package");
			const result = await finalizeFn({ data: { token } });
			setFiles([]);
			setSubmitted({
				pseudonym: result.pseudonym,
				packageId: result.packageId,
			});
		} catch (err) {
			setError((err as Error).message);
			setStatus("Upload paused");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="min-h-screen bg-background px-6 py-10 text-foreground">
			<section className="mx-auto max-w-3xl">
				<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
					Objection evidence channel
				</p>
				<h1 className="mt-4 font-serif text-5xl font-normal">
					Submit evidence for review
				</h1>
				<p className="mt-4 leading-7 text-muted-foreground">
					Files move through signed upload URLs into a private evidence store.
					The public truth certificate uses sanitized artifact labels, not
					filenames or source identity.
				</p>

				{submitted ? (
					<div className="mt-8 border border-chart-5/40 bg-chart-5/10 p-6">
						<CheckCircle2 className="text-chart-5" size={32} />
						<h2 className="mt-4 font-serif text-3xl font-normal">
							Evidence submitted
						</h2>
						<p className="mt-3 leading-7 text-muted-foreground">
							Thank you. Your files have been received and will be reviewed by
							the tribunal. No further action is required from you.
						</p>
						<div className="mt-6 grid gap-3 border-t border-chart-5/30 pt-5 text-sm">
							<div>
								<p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
									Reference
								</p>
								<div className="mt-1 flex items-start gap-3">
									<p className="flex-1 font-semibold">{submitted.pseudonym}</p>
									<CopyValueButton
										value={submitted.pseudonym}
										label="Copy reference"
									/>
								</div>
							</div>
							<div>
								<p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
									Package ID
								</p>
								<div className="mt-1 flex items-start gap-3">
									<p className="flex-1 break-all font-mono text-xs">
										{submitted.packageId}
									</p>
									<CopyValueButton
										value={submitted.packageId}
										label="Copy package ID"
									/>
								</div>
							</div>
						</div>
					</div>
				) : (
					<div className="mt-8 border border-dashed border-border bg-card p-6">
						<UploadCloud className="text-primary" size={32} />
						<input
							className="mt-5 block w-full text-sm"
							type="file"
							multiple
							onChange={(event) =>
								setFiles(Array.from(event.target.files ?? []))
							}
						/>
						<div className="mt-5 grid gap-2">
							{files.map((file) => (
								<div
									className="flex justify-between border border-border px-3 py-2 text-sm"
									key={file.name}
								>
									<span>{file.name}</span>
									<span>{Math.ceil(file.size / 1024)} KB</span>
								</div>
							))}
						</div>
						<Button
							type="button"
							onClick={upload}
							disabled={busy || files.length === 0}
							aria-busy={busy}
							className="mt-5"
						>
							{busy ? (
								<Loader2 className="animate-spin" size={16} />
							) : (
								<UploadCloud size={16} />
							)}
							{busy ? "Working..." : "Submit to tribunal"}
						</Button>
						<p className="mt-4 text-sm font-semibold text-muted-foreground">
							{status}
						</p>
						{error ? (
							<p className="mt-3 text-sm font-semibold text-red-700">{error}</p>
						) : null}
					</div>
				)}
			</section>
		</main>
	);
}
