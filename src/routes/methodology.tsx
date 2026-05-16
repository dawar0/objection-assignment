import { createFileRoute } from "@tanstack/react-router";
import { ScanSearch, SearchCheck, ShieldAlert } from "lucide-react";
import { BackButton } from "#/components/ui/back-button";
import {
	EMBEDDING_SETTINGS,
	METHODOLOGY_VERSION,
	methodologyHash,
	REVIEW_MODEL,
	REVIEW_PROMPTS,
} from "../mastra/verification/methodology";
import type { Tier } from "../mastra/verification/schemas";
import {
	MIN_FACTS_FOR_TIER,
	MIN_VERIFIED_FOR_SUBSTANTIATED,
	SINGLE_SOURCE_RATIO,
	SUBSTANTIATED_RATIO,
	scoreVerificationRun,
	tierDefinition,
} from "../mastra/verification/scoring";

export const Route = createFileRoute("/methodology")({
	component: MethodologyPage,
});

const TIER_ORDER: Tier[] = [
	"Substantiated",
	"Corroborated",
	"Single-source",
	"Disputed",
];

const REVIEWERS = [
	{
		icon: ScanSearch,
		name: "Internal consistency",
		role: "Reads the uploaded artifacts as a closed corpus — extracts core claims, maps timeline, detects contradictions, and notes evidentiary limits.",
		prompt: REVIEW_PROMPTS.internal,
	},
	{
		icon: SearchCheck,
		name: "External corroboration",
		role: "Identifies publicly checkable entities and facts, then classifies Firecrawl search results as verified, contradicted, or not found.",
		prompt: REVIEW_PROMPTS.external,
	},
	{
		icon: ShieldAlert,
		name: "Red team",
		role: "Argues against the package: surfaces fabrication hypotheses, source incentives, missing checks, and assigns each concern a tier impact.",
		prompt: REVIEW_PROMPTS.redTeam,
	},
] as const;

const THRESHOLDS = [
	{
		constant: "SUBSTANTIATED_RATIO",
		value: `${Math.round(SUBSTANTIATED_RATIO * 100)}%`,
		plain: "Public facts must be verified at this rate to reach Substantiated.",
	},
	{
		constant: "MIN_VERIFIED_FOR_SUBSTANTIATED",
		value: `${MIN_VERIFIED_FOR_SUBSTANTIATED} facts`,
		plain:
			"A minimum count of externally verified facts before Substantiated is available.",
	},
	{
		constant: "SINGLE_SOURCE_RATIO",
		value: `${Math.round(SINGLE_SOURCE_RATIO * 100)}%`,
		plain: "Below this verification rate, the package drops to Single-source.",
	},
	{
		constant: "MIN_FACTS_FOR_TIER",
		value: `${MIN_FACTS_FOR_TIER} facts`,
		plain:
			"Fewer public facts than this and the package cannot exceed Single-source.",
	},
];

const RETRIEVAL_ROWS: Array<[string, string]> = [
	["Embedding model", EMBEDDING_SETTINGS.model],
	["Chunk size", `~${EMBEDDING_SETTINGS.chunkSizeTokensApprox} tokens`],
	["Chunk overlap", `~${EMBEDDING_SETTINGS.overlapTokensApprox} tokens`],
	[
		"Top-K per reviewer task",
		`${EMBEDDING_SETTINGS.topKPerReviewerTask} chunks`,
	],
	["Artifact diversity", EMBEDDING_SETTINGS.artifactDiversity ? "on" : "off"],
];

function MethodologyPage() {
	return (
		<main className="min-h-screen bg-background px-6 py-12 text-foreground lg:px-10">
			<div className="mx-auto max-w-4xl">
				<BackButton />
				<header className="mt-2">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Objection methodology
					</p>
					<h1 className="mt-4 font-serif text-5xl font-normal leading-[1.02] md:text-6xl">
						The tribunal protocol
					</h1>
					<p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
						Versioned rules for turning a private evidence package into a public
						truth certificate. This page is the protocol of record — every truth
						certificate links back to the exact version and hash below.
					</p>
				</header>

				<section className="mt-10 border border-border bg-card p-6 md:p-7">
					<p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
						Audit identity
					</p>
					<dl className="mt-4 grid gap-x-8 gap-y-4 text-sm md:grid-cols-2">
						<div>
							<dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
								Version
							</dt>
							<dd className="mt-1 font-mono text-sm">{METHODOLOGY_VERSION}</dd>
						</div>
						<div>
							<dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
								Reviewer model
							</dt>
							<dd className="mt-1 font-mono text-sm">{REVIEW_MODEL}</dd>
						</div>
						<div className="md:col-span-2">
							<dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
								Methodology hash (SHA-256)
							</dt>
							<dd className="mt-1 break-all font-mono text-xs text-foreground/80">
								{methodologyHash()}
							</dd>
						</div>
					</dl>
				</section>

				<section className="mt-12">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Three reviewers
					</p>
					<h2 className="mt-3 font-serif text-3xl font-normal md:text-4xl">
						Parallel adversarial review
					</h2>
					<p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
						Each reviewer runs against the same retrieved evidence chunks and
						returns structured JSON. The prompts below are the exact strings
						sent to the reviewer model.
					</p>
					<div className="mt-6 grid gap-4 md:grid-cols-3">
						{REVIEWERS.map(({ icon: Icon, name, role, prompt }) => (
							<div
								key={name}
								className="flex flex-col border border-border bg-background p-5"
							>
								<Icon className="text-primary" size={26} />
								<h3 className="mt-3 font-serif text-xl font-bold">{name}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									{role}
								</p>
								<blockquote className="mt-4 border-l-2 border-primary/40 pl-3 text-xs italic leading-5 text-foreground/75">
									{prompt}
								</blockquote>
							</div>
						))}
					</div>
				</section>

				<section className="mt-12">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Verdict ladder
					</p>
					<h2 className="mt-3 font-serif text-3xl font-normal md:text-4xl">
						Four tiers, descending confidence
					</h2>
					<ol className="mt-6 space-y-3">
						{TIER_ORDER.map((tier, index) => (
							<li
								key={tier}
								className="flex flex-col gap-2 border-l-2 border-primary bg-card p-4 md:flex-row md:items-baseline md:gap-6"
							>
								<div className="flex items-baseline gap-3 md:w-56 md:shrink-0">
									<span className="font-mono text-xs text-muted-foreground">
										{String(index + 1).padStart(2, "0")}
									</span>
									<span className="font-serif text-xl">{tier}</span>
								</div>
								<p className="text-sm leading-6 text-foreground/80">
									{tierDefinition(tier)}
								</p>
							</li>
						))}
					</ol>
				</section>

				<section className="mt-12">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Decision thresholds
					</p>
					<h2 className="mt-3 font-serif text-3xl font-normal md:text-4xl">
						How the tier is chosen
					</h2>
					<p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
						The score function is a fixed cascade — each gate is evaluated in
						order against the structured output from the three reviewers.
					</p>

					<ol className="mt-6 space-y-2 text-sm leading-6">
						<li className="border border-border bg-background p-4">
							<span className="font-bold">1. Disputed —</span> if any
							disqualifying contradiction, any contradicted public fact or
							entity, or any blocking red-team concern is present.
						</li>
						<li className="border border-border bg-background p-4">
							<span className="font-bold">2. Single-source —</span> if any
							material contradiction, any high-severity downgrade concern, fewer
							than {MIN_FACTS_FOR_TIER} public facts, or a verification ratio
							below {Math.round(SINGLE_SOURCE_RATIO * 100)}%.
						</li>
						<li className="border border-border bg-background p-4">
							<span className="font-bold">3. Substantiated —</span> if at least{" "}
							{Math.round(SUBSTANTIATED_RATIO * 100)}% of public facts are
							verified, {MIN_VERIFIED_FOR_SUBSTANTIATED}+ verified facts exist,
							4+ core claims cite uploaded artifacts, and every red-team concern
							is low severity.
						</li>
						<li className="border border-border bg-background p-4">
							<span className="font-bold">4. Corroborated —</span> the default
							when the package clears Disputed and Single-source but does not
							meet the full Substantiated bar.
						</li>
					</ol>

					<dl className="mt-6 grid gap-4 md:grid-cols-2">
						{THRESHOLDS.map(({ constant, value, plain }) => (
							<div key={constant} className="border border-border bg-card p-4">
								<dt className="flex items-baseline justify-between gap-3">
									<span className="font-mono text-xs text-muted-foreground">
										{constant}
									</span>
									<span className="font-serif text-lg">{value}</span>
								</dt>
								<dd className="mt-2 text-sm leading-6 text-foreground/80">
									{plain}
								</dd>
							</div>
						))}
					</dl>
				</section>

				<section className="mt-12">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Retrieval
					</p>
					<h2 className="mt-3 font-serif text-3xl font-normal md:text-4xl">
						Evidence chunks shown to reviewers
					</h2>
					<dl className="mt-6 divide-y divide-border border border-border bg-card">
						{RETRIEVAL_ROWS.map(([label, value]) => (
							<div
								key={label}
								className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6"
							>
								<dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground md:w-56">
									{label}
								</dt>
								<dd className="font-mono text-sm text-foreground/85">
									{value}
								</dd>
							</div>
						))}
					</dl>
				</section>

				<section className="mt-12">
					<details className="group border border-border bg-card">
						<summary className="flex cursor-pointer items-center justify-between gap-4 p-5">
							<div>
								<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
									Appendix
								</p>
								<h2 className="mt-2 font-serif text-2xl font-normal">
									Auditable scoring source
								</h2>
							</div>
							<span className="font-mono text-xs text-muted-foreground group-open:hidden">
								expand
							</span>
							<span className="hidden font-mono text-xs text-muted-foreground group-open:inline">
								collapse
							</span>
						</summary>
						<pre className="overflow-x-auto bg-primary p-5 text-xs leading-6 text-primary-foreground">
							<code>{scoreVerificationRun.toString()}</code>
						</pre>
					</details>
				</section>
			</div>
		</main>
	);
}
