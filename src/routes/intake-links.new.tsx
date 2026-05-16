import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import * as z from "zod";
import { BackButton } from "#/components/ui/back-button";
import { Button } from "#/components/ui/button";

const createLinkFn = createServerFn({ method: "POST" })
	.inputValidator(z.object({ caseMemo: z.string().optional() }))
	.handler(async ({ data }) => {
		const { createSourceIntakeLink } = await import("../lib/intake");
		return createSourceIntakeLink(data);
	});

export const Route = createFileRoute("/intake-links/new")({
	component: IntakeLinkPage,
});

function IntakeLinkPage() {
	const [memo, setMemo] = useState("");
	const [link, setLink] = useState<string>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);

	async function createLink() {
		setBusy(true);
		setError(undefined);
		setCopied(false);
		try {
			const result = await createLinkFn({ data: { caseMemo: memo } });
			setLink(`${window.location.origin}/source/${result.token}`);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="min-h-screen bg-background px-6 py-10 text-foreground">
			<section className="mx-auto max-w-3xl">
				<BackButton />
				<p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
					Objection case intake
				</p>
				<h1 className="mt-4 font-serif text-5xl font-normal">
					Open an evidence channel
				</h1>
				<p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
					The token is shown once. The database stores only its SHA-256 hash.
					The evidence page asks for files only, not a name or account.
				</p>

				<div className="mt-8 border border-border bg-card p-5">
					<label className="text-sm font-bold" htmlFor="memo">
						Case memo
					</label>
					<textarea
						id="memo"
						value={memo}
						onChange={(event) => setMemo(event.target.value)}
						className="mt-2 min-h-28 w-full border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
						placeholder="Optional case note. Never shown publicly."
					/>
					<Button
						type="button"
						onClick={createLink}
						disabled={busy}
						aria-busy={busy}
						className="mt-4"
					>
						{busy ? (
							<Loader2 className="animate-spin" size={16} />
						) : (
							<Link2 size={16} />
						)}
						{busy ? "Creating..." : "Create evidence link"}
					</Button>
					{error ? (
						<p className="mt-4 text-sm font-semibold text-red-700">{error}</p>
					) : null}
					{link ? (
						<div className="mt-5 border border-border bg-muted p-4">
							<p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
								Evidence channel
							</p>
							<div className="mt-2 flex items-start gap-3">
								<a
									className="block flex-1 break-all text-sm font-semibold text-primary"
									href={link}
								>
									{link}
								</a>
								<button
									type="button"
									aria-label="Copy evidence link"
									className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={async () => {
										await navigator.clipboard.writeText(link);
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
							</div>
						</div>
					) : null}
				</div>
			</section>
		</main>
	);
}
