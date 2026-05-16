import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { useEffect, useState } from "react";
import * as z from "zod";
import { BackButton } from "#/components/ui/back-button";
import { Button } from "#/components/ui/button";

type RunRow = Awaited<ReturnType<typeof import("../lib/intake").getRun>>;

const getRunFn = createServerFn({ method: "GET", strict: false })
	.inputValidator(z.object({ runId: z.string() }))
	.handler(async ({ data }) => {
		const { getRun } = await import("../lib/intake");
		return JSON.parse(JSON.stringify(await getRun(data.runId)));
	});

export const Route = createFileRoute("/jobs/$jobId")({
	loader: ({ params }) => getRunFn({ data: { runId: params.jobId } }),
	component: JobPage,
});

function JobPage() {
	const initialRun = Route.useLoaderData() as RunRow;
	const { jobId } = Route.useParams();
	const [run, setRun] = useState(initialRun);

	useEffect(() => {
		const events = new EventSource(`/api/jobs/${jobId}/stream`);
		events.onmessage = (event) => {
			setRun(JSON.parse(event.data));
		};
		events.onerror = () => {
			events.close();
		};
		return () => events.close();
	}, [jobId]);

	const stepStates = (run?.stepStates ?? {}) as Record<
		string,
		{ status?: string; label?: string }
	>;
	const metadata = ((run?.rawFindingsJson as Record<string, unknown> | null) ??
		{}) as Record<string, unknown>;
	const certificateId = (metadata.certificateId ?? undefined) as
		| string
		| undefined;
	const factCount =
		typeof metadata.corroborationFactCount === "number"
			? metadata.corroborationFactCount
			: 0;
	const sourceCount =
		typeof metadata.corroborationSourceCount === "number"
			? metadata.corroborationSourceCount
			: 0;
	const workflowStatus =
		typeof metadata.mastraWorkflowStatus === "string"
			? metadata.mastraWorkflowStatus
			: undefined;
	const corroborationFailure =
		typeof metadata.corroborationFailureReason === "string"
			? metadata.corroborationFailureReason
			: undefined;

	return (
		<main className="min-h-screen bg-background px-6 py-10 text-foreground">
			<section className="mx-auto max-w-4xl">
				<BackButton />
				<p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
					Objection adjudication
				</p>
				<h1 className="mt-4 font-serif text-5xl font-normal">
					Tribunal status
				</h1>
				<p className="mt-4 text-muted-foreground">
					Each reviewer step writes public-safe findings as it completes. When
					live reviewers are unavailable, Objection records metadata-only
					findings in the same truth certificate shape.
				</p>
				<div className="mt-5 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.12em]">
					<span className="border border-border bg-card px-2 py-1">
						Run {run?.status ?? "missing"}
					</span>
					<span className="border border-border bg-card px-2 py-1">
						{factCount} public facts
					</span>
					<span className="border border-border bg-card px-2 py-1">
						{sourceCount} public sources
					</span>
					{workflowStatus ? (
						<span className="border border-border bg-card px-2 py-1">
							Workflow {workflowStatus}
						</span>
					) : null}
				</div>
				{corroborationFailure ? (
					<div className="mt-4 grid grid-cols-[24px_1fr] border border-chart-4/40 bg-chart-4/10 p-3 text-sm">
						<AlertTriangle className="mt-0.5 text-chart-4" size={16} />
						<p>External corroboration degraded: {corroborationFailure}</p>
					</div>
				) : null}

				<div className="mt-8 grid gap-3">
					{Object.entries(stepStates).map(([key, value]) => (
						<div
							className="grid grid-cols-[28px_1fr] border border-border bg-card p-4"
							key={key}
						>
							{value.status === "complete" ? (
								<CheckCircle2 className="mt-1 text-chart-5" size={20} />
							) : value.status === "failed" || value.status === "degraded" ? (
								<AlertTriangle className="mt-1 text-chart-4" size={20} />
							) : (
								<CircleDashed
									className="mt-1 text-muted-foreground"
									size={20}
								/>
							)}
							<div>
								<p className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
									{key.replaceAll("-", " ")}
								</p>
								<p className="mt-1 leading-6">{value.label}</p>
							</div>
						</div>
					))}
				</div>

				{run?.status === "complete" && certificateId ? (
					<Button asChild className="mt-7">
						<Link
							to="/certificates/$publicId"
							params={{ publicId: certificateId }}
						>
							Open truth certificate
						</Link>
					</Button>
				) : null}
			</section>
		</main>
	);
}
