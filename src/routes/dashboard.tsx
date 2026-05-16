import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	Activity,
	ArrowRight,
	Check,
	CheckCircle2,
	CircleDashed,
	Clock,
	Copy,
	ExternalLink,
	FileText,
	Link2,
	Loader2,
	MoreVertical,
	RefreshCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as z from "zod";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { BackButton } from "#/components/ui/back-button";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import type { DashboardSnapshot } from "../lib/intake";

const listDashboardFn = createServerFn({
	method: "GET",
	strict: false,
}).handler(async () => {
	const { listDashboard } = await import("../lib/intake");
	return listDashboard();
});

const deleteCertificateFn = createServerFn({ method: "POST" })
	.inputValidator(z.object({ publicId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const { deleteCertificate } = await import("../lib/intake");
		return deleteCertificate(data.publicId);
	});

const deleteIntakeLinkFn = createServerFn({ method: "POST" })
	.inputValidator(z.object({ linkId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const { deleteIntakeLink } = await import("../lib/intake");
		return deleteIntakeLink(data.linkId);
	});

export const Route = createFileRoute("/dashboard")({
	loader: () => listDashboardFn(),
	component: DashboardPage,
});

const REFRESH_MS = 4500;

function formatDateTime(value: string | Date | null | undefined) {
	if (value == null) return "Unknown";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown";
	return `${new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date)} UTC`;
}

function timeAgo(value: string) {
	const seconds = Math.max(
		0,
		Math.floor((Date.now() - new Date(value).getTime()) / 1000),
	);
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
	return `${Math.floor(seconds / 86_400)}d ago`;
}

function tierTone(value: string) {
	const normalized = value.toLowerCase();
	if (normalized.includes("disputed"))
		return "border-destructive/30 bg-destructive/10 text-destructive";
	if (normalized.includes("substantiated"))
		return "border-chart-5/30 bg-chart-5/10 text-chart-5";
	if (normalized.includes("corroborated"))
		return "border-primary/30 bg-primary/10 text-primary";
	return "border-chart-4/40 bg-chart-4/10 text-chart-4";
}

function CopyButton({ value, label }: { value: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label={label ?? `Copy ${value}`}
			className="group inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
			{copied ? "Copied" : (label ?? "Copy")}
		</button>
	);
}

function StepDots({
	stepStates,
}: {
	stepStates: Record<string, { status?: string; label?: string }>;
}) {
	const order = [
		"intake",
		"extraction",
		"summaries",
		"embeddings",
		"internal",
		"external",
		"redTeam",
		"scoring",
	];
	const entries = order
		.map((key) => [key, stepStates[key]] as const)
		.filter(([, value]) => value);

	if (entries.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				Awaiting first reviewer step…
			</p>
		);
	}

	return (
		<div className="grid gap-2 text-xs">
			{entries.map(([key, value]) => (
				<div className="grid grid-cols-[18px_1fr] items-start gap-2" key={key}>
					{value?.status === "complete" ? (
						<CheckCircle2 className="mt-0.5 text-chart-5" size={14} />
					) : value?.status === "failed" || value?.status === "degraded" ? (
						<CircleDashed className="mt-0.5 text-chart-4" size={14} />
					) : (
						<CircleDashed className="mt-0.5 text-muted-foreground" size={14} />
					)}
					<div className="min-w-0">
						<p className="font-bold uppercase tracking-[0.1em] text-muted-foreground">
							{key.replace(/([A-Z])/g, " $1").toLowerCase()}
						</p>
						<p className="mt-0.5 leading-5">{value?.label ?? "Pending"}</p>
					</div>
				</div>
			))}
		</div>
	);
}

function DashboardPage() {
	const router = useRouter();
	const initial = Route.useLoaderData() as DashboardSnapshot;
	const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initial);
	const [refreshing, setRefreshing] = useState(false);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [deletingId, setDeletingId] = useState<string>();
	const [deleteError, setDeleteError] = useState<string>();
	const [channelError, setChannelError] = useState<string>();
	const [pendingDelete, setPendingDelete] = useState<{
		kind: "certificate" | "channel";
		id: string;
	}>();
	const timerRef = useRef<number | undefined>(undefined);

	async function refresh() {
		setRefreshing(true);
		try {
			const next = await listDashboardFn();
			setSnapshot(next);
			await router.invalidate();
		} finally {
			setRefreshing(false);
		}
	}

	async function runCertificateDelete(publicId: string) {
		setDeletingId(publicId);
		setDeleteError(undefined);
		try {
			await deleteCertificateFn({ data: { publicId } });
			await refresh();
		} catch (err) {
			setDeleteError((err as Error).message || "Failed to delete certificate.");
		} finally {
			setDeletingId(undefined);
		}
	}

	async function runChannelDelete(linkId: string) {
		setDeletingId(linkId);
		setChannelError(undefined);
		try {
			await deleteIntakeLinkFn({ data: { linkId } });
			await refresh();
		} catch (err) {
			setChannelError(
				(err as Error).message || "Failed to delete evidence channel.",
			);
		} finally {
			setDeletingId(undefined);
		}
	}

	function confirmPendingDelete() {
		if (!pendingDelete) return;
		const { kind, id } = pendingDelete;
		setPendingDelete(undefined);
		if (kind === "certificate") {
			void runCertificateDelete(id);
		} else {
			void runChannelDelete(id);
		}
	}

	const dialogCopy = pendingDelete
		? pendingDelete.kind === "certificate"
			? {
					title: "Delete certificate",
					description:
						"Permanently delete this certificate, evidence package, private chunks, and uploaded files? This cannot be undone.",
					action: "Delete",
				}
			: {
					title: "Close evidence channel",
					description:
						"Close this evidence channel? Any partial uploads will be discarded. This cannot be undone.",
					action: "Close channel",
				}
		: null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is memoized
	useEffect(() => {
		if (!autoRefresh) {
			if (timerRef.current) {
				window.clearInterval(timerRef.current);
				timerRef.current = undefined;
			}
			return;
		}
		timerRef.current = window.setInterval(refresh, REFRESH_MS);
		return () => {
			if (timerRef.current) window.clearInterval(timerRef.current);
		};
	}, [autoRefresh]);

	const { awaitingUpload, processing, published } = snapshot;

	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-8">
			<section className="mx-auto max-w-6xl">
				<BackButton />
				<header className="mt-2 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
					<div>
						<p className="objection-pill">Objection</p>
						<h1 className="mt-4 font-serif text-5xl font-normal leading-tight md:text-7xl">
							Tribunal desk
						</h1>
						<p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
							Every evidence channel, in-flight adjudication, and published
							truth certificate in one Objection workspace.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2 justify-end w-full">
						<button
							type="button"
							onClick={() => setAutoRefresh((value) => !value)}
							className={`inline-flex items-center gap-1.5 border px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] transition-colors ${autoRefresh ? "border-chart-5 bg-chart-5/10 text-chart-5" : "border-border bg-card text-muted-foreground"}`}
						>
							<Clock size={14} /> auto-refresh {autoRefresh ? "on" : "off"}
						</button>
						<Button
							type="button"
							variant="outline"
							onClick={refresh}
							disabled={refreshing}
						>
							<RefreshCw
								className={refreshing ? "animate-spin" : ""}
								size={14}
							/>
							Refresh
						</Button>
						<Button asChild type="button">
							<Link to="/intake-links/new">
								<Link2 size={14} />
								Create evidence link
							</Link>
						</Button>
					</div>
				</header>

				<div className="mt-7 grid gap-4 sm:grid-cols-3">
					<StatTile
						icon={Link2}
						label="Evidence channels"
						value={awaitingUpload.length}
						tone="text-primary"
					/>
					<StatTile
						icon={Clock}
						label="Under review"
						value={processing.length}
						tone="text-chart-4"
					/>
					<StatTile
						icon={ShieldCheck}
						label="Verdicts issued"
						value={published.length}
						tone="text-chart-5"
					/>
				</div>

				<section className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
					<div className="space-y-8">
						<DashboardSection
							title="Evidence channels"
							subtitle="Secure upload links issued, no evidence received yet."
							empty="No open evidence channels."
						>
							{channelError ? (
								<p className="border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
									{channelError}
								</p>
							) : null}
							{awaitingUpload.map((link) => (
								<div className="border border-border bg-card p-4" key={link.id}>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
												Issued {timeAgo(link.createdAt)}
											</p>
											<p className="mt-1 font-semibold">
												Awaiting evidence upload
											</p>
											{link.caseMemo ? (
												<p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
													“{link.caseMemo}”
												</p>
											) : null}
										</div>
										<div className="flex items-start gap-2">
											<span className="border border-primary/30 bg-primary/10 px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-primary">
												Active
											</span>
											<CardActionsMenu
												runId={null}
												deleting={deletingId === link.id}
												onDelete={() =>
													setPendingDelete({ kind: "channel", id: link.id })
												}
											/>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
										<span>Expires {formatDateTime(link.expiresAt)}</span>
									</div>
								</div>
							))}
						</DashboardSection>

						<DashboardSection
							title="Under review"
							subtitle="Evidence received. The AI tribunal and public corroboration checks are still running."
							empty="No cases currently in review."
						>
							{processing.map((pkg) => (
								<div
									className="border border-border bg-card p-4"
									key={pkg.packageId}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
												Intake {timeAgo(pkg.intakeTs)}
											</p>
											<p className="mt-1 font-semibold">{pkg.pseudonym}</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{pkg.fileCount} {pkg.fileCount === 1 ? "file" : "files"}{" "}
												· anchor {pkg.anchorStatus}
											</p>
										</div>
										{pkg.runId ? (
											<Button asChild size="sm" variant="outline">
												<Link to="/jobs/$jobId" params={{ jobId: pkg.runId }}>
													Open adjudication <ArrowRight size={14} />
												</Link>
											</Button>
										) : (
											<span className="border border-chart-4/30 bg-chart-4/10 px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-chart-4">
												Starting
											</span>
										)}
									</div>
									<div className="mt-3 border-t border-border pt-3">
										<StepDots stepStates={pkg.stepStates} />
									</div>
								</div>
							))}
						</DashboardSection>

						<DashboardSection
							title="Truth certificates"
							subtitle="Public, privacy-preserving verdict records ready for citation."
							empty="No certificates yet. Open an evidence channel and finalize a case to publish one."
						>
							{deleteError ? (
								<p className="border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
									{deleteError}
								</p>
							) : null}
							{published.map((cert) => (
								<article
									className="border border-border bg-card p-4"
									key={cert.publicId}
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
												Published {timeAgo(cert.publishedAt)} ·{" "}
												{formatDateTime(cert.publishedAt)}
											</p>
											<h3 className="mt-1 font-serif text-2xl font-bold">
												{cert.pseudonym}
											</h3>
											<p className="mt-1 text-xs text-muted-foreground">
												{cert.fileCount}{" "}
												{cert.fileCount === 1 ? "file" : "files"} reviewed
											</p>
										</div>
										<div className="flex items-start gap-2">
											<span
												className={`border px-2 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] ${tierTone(cert.tier)}`}
											>
												{cert.tier}
											</span>
											<CardActionsMenu
												runId={cert.runId}
												deleting={deletingId === cert.publicId}
												onDelete={() =>
													setPendingDelete({
														kind: "certificate",
														id: cert.publicId,
													})
												}
											/>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
										<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
											<CopyButton value={cert.publicId} label="Copy ID" />
											{cert.manifestHash ? (
												<CopyButton
													value={cert.manifestHash}
													label="Copy manifest hash"
												/>
											) : null}
										</div>
										<Button asChild size="sm">
											<Link
												to="/certificates/$publicId"
												params={{ publicId: cert.publicId }}
											>
												Open verdict <ExternalLink size={14} />
											</Link>
										</Button>
									</div>
								</article>
							))}
						</DashboardSection>
					</div>

					<aside className="lg:sticky lg:top-6 lg:self-start">
						<div className="border border-border bg-card p-5">
							<p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
								Where to next
							</p>
							<ul className="mt-3 grid gap-3 text-sm leading-6">
								<li className="grid grid-cols-[20px_1fr] gap-2">
									<FileText className="mt-0.5 text-primary" size={16} />
									<Link className="hover:underline" to="/methodology">
										Review the tribunal methodology
									</Link>
								</li>
								<li className="grid grid-cols-[20px_1fr] gap-2">
									<ShieldCheck className="mt-0.5 text-primary" size={16} />
									<Link className="hover:underline" to="/">
										Objection home
									</Link>
								</li>
							</ul>
						</div>
					</aside>
				</section>
			</section>
			<AlertDialog
				open={pendingDelete !== undefined}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(undefined);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{dialogCopy?.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{dialogCopy?.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={confirmPendingDelete}
						>
							{dialogCopy?.action}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</main>
	);
}

function CardActionsMenu({
	runId,
	deleting,
	onDelete,
}: {
	runId: string | null;
	deleting: boolean;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label="More actions"
					className="inline-flex h-8 w-8 items-center justify-center border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<MoreVertical size={16} />
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-44 gap-0 p-1">
				{runId ? (
					<Link
						to="/jobs/$jobId"
						params={{ jobId: runId }}
						onClick={() => setOpen(false)}
						className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted"
					>
						<Activity size={14} /> Job status
					</Link>
				) : null}
				<button
					type="button"
					disabled={deleting}
					aria-busy={deleting}
					onClick={() => {
						setOpen(false);
						onDelete();
					}}
					className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{deleting ? (
						<Loader2 className="animate-spin" size={14} />
					) : (
						<Trash2 size={14} />
					)}
					{deleting ? "Deleting" : "Delete"}
				</button>
			</PopoverContent>
		</Popover>
	);
}

function StatTile({
	icon: Icon,
	label,
	value,
	tone,
}: {
	icon: typeof Link2;
	label: string;
	value: number;
	tone: string;
}) {
	return (
		<div className="flex items-center gap-3 border border-border bg-card p-4">
			<Icon className={tone} size={24} />
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
					{label}
				</p>
				<p className="font-serif text-3xl font-bold">{value}</p>
			</div>
		</div>
	);
}

function DashboardSection({
	title,
	subtitle,
	empty,
	children,
}: {
	title: string;
	subtitle: string;
	empty: string;
	children: React.ReactNode;
}) {
	const childrenList = Array.isArray(children)
		? children.flat(Number.POSITIVE_INFINITY)
		: [children];
	const hasChildren = childrenList.some(
		(child) => child !== null && child !== undefined && child !== false,
	);
	return (
		<section>
			<h2 className="font-serif text-3xl font-normal">{title}</h2>
			<p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
			<div className="mt-4 grid gap-3">
				{hasChildren ? (
					children
				) : (
					<p className="border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
						{empty}
					</p>
				)}
			</div>
		</section>
	);
}
