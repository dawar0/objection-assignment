import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	AlertTriangle,
	Check,
	Copy,
	ExternalLink,
	FileText,
	Fingerprint,
	LockKeyhole,
	ShieldCheck,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import * as z from "zod";
import { Button } from "#/components/ui/button";
import type {
	ArtifactCitation,
	CertificatePayload,
	ExternalSource,
} from "../mastra/verification/schemas";

type CertificateRow = Awaited<
	ReturnType<typeof import("../lib/intake").getCertificate>
>;

type PublicFileRef = {
	artifactId?: string;
	label?: string;
	mimeType?: string;
	sizeBytes?: number;
	sha256?: string;
};

const getCertificateFn = createServerFn({ method: "GET", strict: false })
	.inputValidator(z.object({ publicId: z.string() }))
	.handler(async ({ data }) => {
		const { getCertificate } = await import("../lib/intake");
		const {
			fallbackCertificatePayload,
			normalizeCertificatePayloadForDisplay,
		} = await import("../mastra/verification/fallback");
		const row = await getCertificate(data.publicId);

		if (!row) {
			return null;
		}

		const payload = row.certificate
			.evidenceBreakdown as Partial<CertificatePayload>;
		if (!payload.confidenceScore || !payload.provenanceLedger) {
			const refs = (
				Array.isArray(row.package.fileRefs) ? row.package.fileRefs : []
			) as PublicFileRef[];
			row.certificate.evidenceBreakdown = fallbackCertificatePayload({
				manifestFiles: refs
					.filter((ref) => ref.artifactId && ref.mimeType && ref.sha256)
					.map((ref, index) => ({
						artifactId: ref.artifactId ?? `legacy-artifact-${index + 1}`,
						label: ref.label ?? `Artifact ${String.fromCharCode(65 + index)}`,
						mimeType: ref.mimeType ?? "application/octet-stream",
						sizeBytes: ref.sizeBytes ?? 0,
						sha256: ref.sha256 ?? "unavailable",
					})),
				intakeTimestamp: row.package.intakeTs.toISOString(),
				finalizedAt: row.certificate.publishedAt.toISOString(),
				manifestHash: row.package.manifestHash ?? "unavailable",
				anchorStatus: row.package.anchorStatus,
				anchorProof: row.package.anchorProof,
			});
		}

		row.certificate.evidenceBreakdown = normalizeCertificatePayloadForDisplay(
			row.certificate.evidenceBreakdown as CertificatePayload,
		);

		return JSON.parse(JSON.stringify(row));
	});

export const Route = createFileRoute("/certificates/$publicId")({
	loader: ({ params }) =>
		getCertificateFn({ data: { publicId: params.publicId } }),
	component: CertificatePage,
});

function collectSources(payload: CertificatePayload) {
	const seen = new Set<string>();
	const sources: ExternalSource[] = [];
	const candidates = [
		...payload.findings.external.entityFindings.flatMap(
			(finding) => finding.sources,
		),
		...payload.findings.external.publicFacts.flatMap((fact) => fact.sources),
		...payload.externalChecks.flatMap((check) => check.sources),
	];

	for (const source of candidates) {
		const key = `${source.url}-${source.title}`;
		if (!seen.has(key)) {
			seen.add(key);
			sources.push(source);
		}
	}

	return sources;
}

function formatDate(value: string | Date | null | undefined) {
	if (value == null) return "Unknown";
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "Unknown";
	return `${new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date)} UTC`;
}

function CopyableField({
	value,
	display,
	className,
	iconClassName,
	hoverClassName,
	ariaLabel,
}: {
	value: string;
	display?: ReactNode;
	className?: string;
	iconClassName?: string;
	hoverClassName?: string;
	ariaLabel?: string;
}) {
	const [copied, setCopied] = useState(false);

	return (
		<button
			type="button"
			aria-label={ariaLabel ?? `Copy ${value}`}
			onClick={async (event) => {
				event.stopPropagation();
				await navigator.clipboard.writeText(value);
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1400);
			}}
			className={`group inline-flex w-full items-start gap-2 text-left transition-colors ${hoverClassName ?? "hover:text-primary"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
		>
			<span className="min-w-0 flex-1 break-all">{display ?? value}</span>
			{copied ? (
				<Check
					className={`mt-0.5 shrink-0 text-chart-5 ${iconClassName ?? ""}`}
					size={14}
				/>
			) : (
				<Copy
					className={`mt-0.5 shrink-0 opacity-60 group-hover:opacity-100 ${iconClassName ?? ""}`}
					size={14}
				/>
			)}
		</button>
	);
}

const unavailableHashValues = new Set([
	"",
	"unavailable",
	"local-sha256-manifest-hash",
]);

function isUnavailableHash(value?: string | null) {
	return unavailableHashValues.has((value ?? "").trim().toLowerCase());
}

function HashField({
	value,
	display,
	className,
	iconClassName,
	hoverClassName,
	ariaLabel,
}: {
	value?: string | null;
	display?: ReactNode;
	className?: string;
	iconClassName?: string;
	hoverClassName?: string;
	ariaLabel: string;
}) {
	if (isUnavailableHash(value)) {
		return (
			<span className={`block min-w-0 break-all ${className ?? ""}`}>
				Unavailable
			</span>
		);
	}

	return (
		<CopyableField
			value={value ?? ""}
			display={display ?? value}
			className={className}
			iconClassName={iconClassName}
			hoverClassName={hoverClassName}
			ariaLabel={ariaLabel}
		/>
	);
}

function CopyableTile({
	label,
	value,
	display,
	mono,
	hash,
}: {
	label: string;
	value: string;
	display?: ReactNode;
	mono?: boolean;
	hash?: boolean;
}) {
	return (
		<div className="border border-border bg-background p-3">
			<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
			<div
				className={`mt-2 ${mono ? "font-mono text-xs leading-5" : "font-semibold"}`}
			>
				{hash ? (
					<HashField
						value={value}
						display={display ?? value}
						ariaLabel={`Copy ${label.toLowerCase()}`}
					/>
				) : (
					<CopyableField
						value={value}
						display={display ?? value}
						ariaLabel={`Copy ${label.toLowerCase()}`}
					/>
				)}
			</div>
		</div>
	);
}

function statusClass(value: string) {
	const normalized = value.toLowerCase();
	if (
		normalized.includes("high") ||
		normalized.includes("unavailable") ||
		normalized.includes("downgrade")
	) {
		return "border-destructive/30 bg-destructive/10 text-destructive";
	}
	if (
		normalized.includes("medium") ||
		normalized.includes("single") ||
		normalized.includes("partial")
	) {
		return "border-chart-4/40 bg-chart-4/10 text-chart-4";
	}
	return "border-chart-5/30 bg-chart-5/10 text-chart-5";
}

function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
	return (
		<span
			className={`inline-flex w-fit items-center border px-2 py-1 text-[0.68rem] font-bold uppercase tracking-[0.12em] ${statusClass(
				tone ?? String(children ?? ""),
			)}`}
		>
			{children}
		</span>
	);
}

function CitationList({ citations }: { citations: ArtifactCitation[] }) {
	if (citations.length === 0) {
		return (
			<span className="text-muted-foreground">No public-safe citation.</span>
		);
	}

	return (
		<div className="flex flex-wrap gap-2">
			{citations.map((citation) => (
				<span
					className="border border-border bg-background px-2 py-1 text-xs"
					key={`${citation.artifactId}-${citation.locator}`}
				>
					{citation.label}
				</span>
			))}
		</div>
	);
}

function CertificatePage() {
	const row = Route.useLoaderData() as CertificateRow;
	const [copiedSnippet, setCopiedSnippet] = useState<string>();

	if (!row) {
		return (
			<main className="min-h-screen bg-background p-8 text-foreground">
				Objection truth certificate not found.
			</main>
		);
	}

	const payload = row.certificate.evidenceBreakdown as CertificatePayload;
	const sources = collectSources(payload);
	const ledger = payload.provenanceLedger;
	const entityConsistency = payload.findings.internal.entityConsistency;
	const hasTimelineOrEntityConsistency =
		payload.timeline.length > 0 || entityConsistency.length > 0;

	return (
		<main className="min-h-screen bg-background px-4 py-8 text-foreground md:px-6">
			<section className="mx-auto max-w-7xl">
				<div className="grid gap-6 lg:grid-cols-[1fr_360px]">
					<article className="bg-card p-5 shadow-sm ring-1 ring-border md:p-8">
						<header className="border-b border-border pb-6">
							<div className="flex flex-wrap items-center gap-3">
								<Badge tone={payload.tier}>{payload.tier}</Badge>
								<Badge tone={`${payload.confidenceScore}`}>
									{payload.confidenceScore}/100 confidence
								</Badge>
								<Badge tone={ledger.anchorStatus}>
									Anchor {ledger.anchorStatus}
								</Badge>
							</div>
							<p className="objection-pill mt-5">Objection</p>
							<h1 className="mt-4 font-serif text-5xl font-normal leading-tight md:text-7xl">
								Truth certificate
							</h1>
							<p className="mt-4 max-w-4xl text-lg leading-8 text-muted-foreground">
								{payload.verifiedSummary}
							</p>
							<div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
								<CopyableTile
									label="Certificate ID"
									value={row.certificate.publicId}
								/>
								<CopyableTile
									label="Published"
									value={new Date(row.certificate.publishedAt).toISOString()}
									display={formatDate(row.certificate.publishedAt)}
								/>
								<CopyableTile
									label="Files reviewed"
									value={`${ledger.fileCount}`}
								/>
							</div>
						</header>

						<section className="mt-8">
							<h2 className="font-serif text-3xl font-normal">
								What this truth certificate adjudicates
							</h2>
							<div className="mt-4 grid gap-3 md:grid-cols-2">
								{payload.checkedItems.map((item) => (
									<div
										className="grid grid-cols-[26px_1fr] border border-border bg-background p-4"
										key={item}
									>
										<ShieldCheck className="mt-1 text-chart-5" size={18} />
										<p className="leading-6">{item}</p>
									</div>
								))}
							</div>
							<div className="mt-4 grid grid-cols-[26px_1fr] border border-destructive/30 bg-destructive/10 p-4">
								<AlertTriangle className="mt-1 text-destructive" size={18} />
								<p className="leading-6">
									This records process, integrity signals, consistency, and
									corroboration level. It does not certify that any underlying
									allegation is true beyond the evidence reviewed.
								</p>
							</div>
						</section>

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								Provenance ledger
							</h2>
							<div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
								<CopyableTile
									label="Intake timestamp"
									value={new Date(ledger.intakeTimestamp).toISOString()}
									display={formatDate(ledger.intakeTimestamp)}
									mono
								/>
								<CopyableTile
									label="Finalized timestamp"
									value={new Date(ledger.finalizedAt).toISOString()}
									display={formatDate(ledger.finalizedAt)}
									mono
								/>
								<CopyableTile
									label="Manifest hash"
									value={ledger.manifestHash}
									mono
									hash
								/>
								<CopyableTile
									label="Methodology hash"
									value={ledger.methodologyHash}
									mono
								/>
								<CopyableTile
									label="Methodology version"
									value={ledger.methodologyVersion}
									mono
								/>
								<CopyableTile
									label="Anchor proof"
									value={`${ledger.anchorProofType}: ${ledger.anchorProofNote}`}
									mono
								/>
							</div>

							<div className="mt-5 overflow-x-auto border border-border">
								<table className="w-full min-w-[640px] border-collapse text-left text-sm">
									<thead className="bg-muted text-xs uppercase tracking-[0.12em] text-muted-foreground">
										<tr>
											<th className="border-b border-border p-3">Artifact</th>
											<th className="border-b border-border p-3">Type</th>
											<th className="border-b border-border p-3">SHA-256</th>
										</tr>
									</thead>
									<tbody>
										{ledger.files.map((file) => (
											<tr className="align-top" key={file.artifactId}>
												<td className="border-b border-border p-3 font-semibold">
													{file.label}
												</td>
												<td className="border-b border-border p-3">
													{file.evidenceType}
												</td>
												<td className="border-b border-border p-3 font-mono text-xs">
													<HashField
														value={file.sha256 ?? file.hashPreview}
														display={file.hashPreview}
														ariaLabel={`Copy SHA-256 for ${file.label}`}
													/>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								Evidence docket
							</h2>
							<div className="mt-4 grid gap-4">
								{payload.artifactSummaries.map((artifact) => (
									<details
										className="border border-border bg-background p-4"
										key={artifact.artifactId}
										open
									>
										<summary className="cursor-pointer list-none">
											<div className="flex flex-wrap items-start justify-between gap-3">
												<div>
													<p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
														{artifact.evidenceType}
													</p>
													<h3 className="mt-1 font-serif text-2xl font-normal">
														{artifact.label}
													</h3>
												</div>
												<Badge tone={artifact.extractionStatus}>
													{artifact.extractionStatus}
												</Badge>
											</div>
										</summary>
										{artifact.publicSafeSynopsis.trim() ? (
											<p className="mt-4 leading-7 text-muted-foreground">
												{artifact.publicSafeSynopsis}
											</p>
										) : null}
										{artifact.role.trim() ? (
											<p className="mt-3 leading-7">{artifact.role}</p>
										) : null}
										{artifact.metadata.length > 0 ? (
											<dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
												{artifact.metadata.map((item) => (
													<div
														className="border border-border bg-card px-3 py-2"
														key={`${artifact.artifactId}-${item.label}`}
													>
														<dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
															{item.label}
														</dt>
														<dd className="mt-1 break-words font-medium">
															{item.value}
														</dd>
													</div>
												))}
											</dl>
										) : null}
										{artifact.signals.length > 0 ? (
											<div className="mt-4">
												<h4 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
													Signals
												</h4>
												<ul className="mt-2 grid gap-2 text-sm leading-6">
													{artifact.signals.map((signal) => (
														<li
															className="border-l-2 border-primary pl-3"
															key={signal}
														>
															{signal}
														</li>
													))}
												</ul>
											</div>
										) : null}
										{artifact.excerpts.length > 0 ||
										artifact.limitations.length > 0 ? (
											<div className="mt-4 grid gap-3 md:grid-cols-2">
												{artifact.excerpts.length > 0 ? (
													<div>
														<h4 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
															Public-safe excerpts
														</h4>
														<div className="mt-2 grid gap-2">
															{artifact.excerpts.map((excerpt) => (
																<blockquote
																	className="border-l-2 border-chart-5 pl-3 text-sm leading-6"
																	key={excerpt.locator}
																>
																	<span className="font-semibold">
																		{excerpt.locator}:
																	</span>{" "}
																	{excerpt.text}
																</blockquote>
															))}
														</div>
													</div>
												) : null}
												{artifact.limitations.length > 0 ? (
													<div>
														<h4 className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
															Limits
														</h4>
														<ul className="mt-2 grid gap-2 text-sm leading-6">
															{artifact.limitations.map((limitation) => (
																<li
																	className="border-l-2 border-destructive pl-3"
																	key={limitation}
																>
																	{limitation}
																</li>
															))}
														</ul>
													</div>
												) : null}
											</div>
										) : null}
									</details>
								))}
							</div>
						</section>

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								Claim corroboration matrix
							</h2>
							<div className="mt-4 grid gap-4">
								{payload.claimMatrix.length === 0 ? (
									<p className="border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
										No public content claims were extracted for corroboration.
										Provenance and processing checks are shown in the ledger.
									</p>
								) : (
									payload.claimMatrix.map((claim) => (
										<div
											className="border border-border bg-background p-4"
											key={claim.claim}
										>
											<div className="flex flex-wrap items-start justify-between gap-3">
												<h3 className="max-w-3xl font-bold leading-6">
													{claim.claim}
												</h3>
												<div className="flex flex-wrap gap-2">
													<Badge tone={claim.confidence}>
														{claim.confidence}
													</Badge>
													<Badge tone={claim.supportLevel}>
														{claim.supportLevel.replaceAll("_", " ")}
													</Badge>
												</div>
											</div>
											<p className="mt-3 text-sm leading-6 text-muted-foreground">
												{claim.publicCorroboration}
											</p>
											<p className="mt-2 text-sm leading-6">
												{claim.riskNotes}
											</p>
											<div className="mt-3">
												<CitationList citations={claim.supportingArtifacts} />
											</div>
										</div>
									))
								)}
							</div>
						</section>

						{hasTimelineOrEntityConsistency ? (
							<section className="mt-8 border-t border-border pt-7">
								<h2 className="font-serif text-3xl font-normal">
									Timeline and entity summaries
								</h2>
								<div
									className={`mt-4 grid gap-4 ${
										payload.timeline.length > 0 && entityConsistency.length > 0
											? "lg:grid-cols-2"
											: ""
									}`}
								>
									{payload.timeline.length > 0 ? (
										<div className="grid gap-3">
											{payload.timeline.map((item) => (
												<div
													className="border border-border bg-background p-4"
													key={item.event}
												>
													<Badge tone={item.confidence}>
														{item.confidence}
													</Badge>
													<h3 className="mt-2 font-bold">{item.event}</h3>
													<p className="mt-1 text-sm text-muted-foreground">
														{item.dateText}
													</p>
													<div className="mt-3">
														<CitationList citations={item.citations} />
													</div>
												</div>
											))}
										</div>
									) : null}
									{entityConsistency.length > 0 ? (
										<div className="grid gap-3">
											{entityConsistency.map((entity) => (
												<div
													className="border border-border bg-background p-4"
													key={entity.entity}
												>
													<div className="flex flex-wrap items-start justify-between gap-3">
														<h3 className="font-bold">{entity.entity}</h3>
														<Badge tone={entity.consistency}>
															{entity.consistency}
														</Badge>
													</div>
													<p className="mt-2 text-sm leading-6 text-muted-foreground">
														{entity.summary}
													</p>
													{entity.aliases.length > 0 ? (
														<div className="mt-3 flex flex-wrap gap-2">
															{entity.aliases.map((alias) => (
																<span
																	className="border border-border bg-card px-2 py-1 text-xs"
																	key={`${entity.entity}-${alias}`}
																>
																	{alias}
																</span>
															))}
														</div>
													) : null}
													<div className="mt-3">
														<CitationList citations={entity.citations} />
													</div>
												</div>
											))}
										</div>
									) : null}
								</div>
							</section>
						) : null}

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								External corroboration
							</h2>
							<div className="mt-4 grid gap-4">
								{payload.externalChecks.map((check) => (
									<div
										className="border border-border bg-background p-4"
										key={`${check.label}-${check.result}`}
									>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<h3 className="font-bold">{check.label}</h3>
											<div className="flex flex-wrap gap-2">
												<Badge tone={check.result}>
													{check.result.replaceAll("_", " ")}
												</Badge>
												<Badge tone={check.confidence}>
													{check.confidence}
												</Badge>
											</div>
										</div>
										<p className="mt-2 text-sm leading-6 text-muted-foreground">
											{check.whatItCorroborates}
										</p>
										<div className="mt-3 grid gap-2">
											{check.sources.map((source) => (
												<a
													className="inline-flex w-fit items-start gap-2 text-sm"
													href={source.url}
													key={`${check.label}-${source.url}`}
													rel="noreferrer"
													target="_blank"
												>
													<ExternalLink className="mt-0.5 shrink-0" size={14} />
													<span>
														{source.title}
														<span className="block text-xs text-muted-foreground">
															Accessed {formatDate(source.accessedAt)}.{" "}
															{source.snippet}
														</span>
													</span>
												</a>
											))}
										</div>
									</div>
								))}
							</div>
						</section>

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								Adversarial analysis
							</h2>
							<div className="mt-4 grid gap-4">
								{payload.concerns.map((concern) => (
									<div
										className="border border-border bg-background p-4"
										key={concern.concern}
									>
										<div className="flex flex-wrap gap-2">
											<Badge tone={concern.severity}>
												{concern.severity} concern
											</Badge>
											<Badge tone={concern.tierImpact}>
												{concern.tierImpact.replaceAll("_", " ")}
											</Badge>
										</div>
										<h3 className="mt-3 font-bold">{concern.concern}</h3>
										<p className="mt-2 leading-6 text-muted-foreground">
											{concern.publicExplanation}
										</p>
										<div className="mt-3">
											<CitationList citations={concern.citations} />
										</div>
									</div>
								))}
								<div className="grid gap-4 lg:grid-cols-2">
									<div className="border border-border bg-background p-4">
										<h3 className="font-bold">Fabrication hypotheses</h3>
										<div className="mt-3 grid gap-3">
											{payload.findings.redTeam.fabricationHypotheses.map(
												(item) => (
													<div
														className="border-l-2 border-destructive pl-3"
														key={item.hypothesis}
													>
														<p className="text-sm font-semibold">
															{item.hypothesis}
														</p>
														<p className="mt-1 text-sm leading-6 text-muted-foreground">
															Would reduce concern:{" "}
															{item.evidenceThatWouldReduceConcern}
														</p>
													</div>
												),
											)}
										</div>
									</div>
									<div className="border border-border bg-background p-4">
										<h3 className="font-bold">Missing checks</h3>
										<ul className="mt-3 grid gap-2 text-sm leading-6">
											{payload.findings.redTeam.missingChecks.map((check) => (
												<li
													className="border-l-2 border-chart-4 pl-3"
													key={check}
												>
													{check}
												</li>
											))}
										</ul>
										<p className="mt-4 text-sm leading-6 text-muted-foreground">
											{payload.findings.redTeam.sourceIncentiveAssessment}
										</p>
									</div>
								</div>
							</div>
						</section>

						<section className="mt-8 border-t border-border pt-7">
							<h2 className="font-serif text-3xl font-normal">
								Attribution language
							</h2>
							<div className="mt-4 grid gap-3">
								{payload.attributionSnippets.map((snippet) => (
									<button
										className="flex cursor-pointer items-start gap-3 border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										key={snippet.label}
										type="button"
										onClick={async () => {
											await navigator.clipboard.writeText(snippet.text);
											setCopiedSnippet(snippet.label);
											window.setTimeout(
												() => setCopiedSnippet(undefined),
												1400,
											);
										}}
									>
										{copiedSnippet === snippet.label ? (
											<Check className="mt-1 shrink-0 text-chart-5" size={16} />
										) : (
											<Copy className="mt-1 shrink-0 text-primary" size={16} />
										)}
										<span>
											<strong>{snippet.label}</strong>
											<span className="ml-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
												{copiedSnippet === snippet.label ? "Copied" : "Copy"}
											</span>
											<span className="mt-1 block text-sm leading-6 text-muted-foreground">
												{snippet.text}
											</span>
										</span>
									</button>
								))}
							</div>
						</section>
					</article>

					<aside className="h-fit min-w-0 overflow-hidden bg-primary p-5 text-primary-foreground ring-1 ring-primary lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
						<h2 className="font-serif text-3xl font-normal">
							Public record rail
						</h2>
						<div className="mt-5 grid gap-4 text-sm">
							<div className="grid grid-cols-[24px_1fr] gap-3">
								<Fingerprint className="mt-1" size={18} />
								<div className="min-w-0">
									<p className="font-bold">Manifest hash</p>
									<div className="font-mono text-xs text-primary-foreground/75">
										<HashField
											value={ledger.manifestHash}
											ariaLabel="Copy manifest hash"
											iconClassName="text-primary-foreground"
											hoverClassName="hover:text-primary-foreground"
										/>
									</div>
								</div>
							</div>
							<div className="grid grid-cols-[24px_1fr] gap-3">
								<FileText className="mt-1" size={18} />
								<div>
									<p className="font-bold">Evidence package</p>
									<p className="break-words text-primary-foreground/75">
										{ledger.fileCount} files, raw evidence withheld.
									</p>
								</div>
							</div>
							<div className="grid grid-cols-[24px_1fr] gap-3">
								<LockKeyhole className="mt-1" size={18} />
								<div>
									<p className="font-bold">Privacy redactions</p>
									<ul className="mt-2 grid gap-2 break-words text-primary-foreground/75">
										{payload.privacyRedactions.map((redaction) => (
											<li key={redaction}>{redaction}</li>
										))}
									</ul>
								</div>
							</div>
						</div>
						<Button
							asChild
							variant="outline"
							className="mt-5 w-full border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white"
						>
							<Link to="/methodology">Methodology page</Link>
						</Button>

						<section className="mt-7 border-t border-white/20 pt-5">
							<h3 className="font-bold">External sources checked</h3>
							<ol className="mt-3 grid gap-3 text-sm">
								{sources.map((source, index) => (
									<li key={`${source.url}`}>
										<a
											className="inline-flex min-w-0 items-start gap-2 break-words text-[#fff7df] underline decoration-[#fff7df]/55 underline-offset-4 transition-colors hover:text-white hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fff7df]"
											href={source.url}
											rel="noreferrer"
											target="_blank"
										>
											<span className="font-semibold text-[#fff7df]">
												[{index + 1}]
											</span>
											<span className="min-w-0">
												{source.title}
												<ExternalLink
													className="ml-1 inline text-current"
													size={12}
												/>
											</span>
										</a>
										<p className="mt-1 text-xs leading-5 text-primary-foreground/70">
											Accessed {formatDate(source.accessedAt)}. {source.snippet}
										</p>
									</li>
								))}
							</ol>
						</section>
					</aside>
				</div>
			</section>
		</main>
	);
}
