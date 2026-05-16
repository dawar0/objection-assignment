import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	FileCheck2,
	Fingerprint,
	Inbox,
	LayoutDashboard,
	ScanSearch,
	SearchCheck,
	ShieldAlert,
	Stamp,
} from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main className="min-h-screen bg-background text-foreground">
			<section className="objection-hero text-primary-foreground">
				<div className="mx-auto grid min-h-[88vh] max-w-6xl gap-12 px-6 pt-12 pb-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-10">
					<div className="flex flex-col justify-center">
						<p className="objection-pill mb-5">Objection</p>
						<h1 className="font-serif text-6xl font-normal leading-[0.98] md:text-8xl">
							The AI Tribunal of Truth
						</h1>
						<p className="mt-7 max-w-2xl text-lg leading-8 text-primary-foreground/78">
							Challenge contested media claims through a structured evidentiary
							process. Objection gathers records, tests both sides, and
							publishes a reasoned public truth certificate.
						</p>
						<div className="mt-9 flex flex-wrap gap-3">
							<Button asChild>
								<Link to="/dashboard">
									Open tribunal desk <LayoutDashboard size={16} />
								</Link>
							</Button>
							<Button asChild variant="secondary">
								<Link to="/intake-links/new">
									Submit evidence <ArrowRight size={16} />
								</Link>
							</Button>
							<Button
								asChild
								variant="outline"
								className="border-white/25 text-white hover:bg-white/10 hover:text-white"
							>
								<Link to="/methodology">View methodology</Link>
							</Button>
						</div>
					</div>

					<Link
						to="/dashboard"
						className="group block self-center border border-white/12 bg-[#f9f6f1] p-6 text-[#1a1612] shadow-sm transition-colors hover:border-white/40"
					>
						<div className="border-b border-border pb-5">
							<p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
								Tribunal desk
							</p>
							<h2 className="mt-3 font-serif text-4xl font-normal">
								Claims, evidence, verdicts
							</h2>
							<p className="mt-3 text-sm leading-6 text-muted-foreground">
								Issue evidence links, watch adjudication runs progress live,
								open published truth certificates, and purge records when a case
								must be withdrawn.
							</p>
						</div>
						<div className="grid gap-4 py-5">
							{[
								[
									FileCheck2,
									"Evidence docket",
									"Awaiting upload, in-review, and adjudicated truth certificates surface in one view.",
								],
								[
									SearchCheck,
									"Adversarial review",
									"Reviewer agents test claims against internal artifacts and public corroboration.",
								],
								[
									ShieldAlert,
									"Limits first",
									"Unresolved evidentiary gaps are published alongside every finding.",
								],
								[
									Fingerprint,
									"Public record",
									"Hashes and methodology versions make each truth certificate independently inspectable.",
								],
							].map(([Icon, title, text]) => (
								<div
									className="grid grid-cols-[32px_1fr] gap-3"
									key={title as string}
								>
									<Icon className="mt-1 text-primary" size={22} />
									<div>
										<h3 className="font-bold">{title as string}</h3>
										<p className="text-sm leading-6 text-muted-foreground">
											{text as string}
										</p>
									</div>
								</div>
							))}
						</div>
						<p className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.16em] text-primary group-hover:underline">
							Open tribunal desk <ArrowRight size={14} />
						</p>
					</Link>
				</div>
			</section>

			<section className="border-t border-border bg-muted/40">
				<div className="mx-auto max-w-6xl px-6 py-14 lg:px-10">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
						Empirical process
					</p>
					<h2 className="mt-3 max-w-3xl font-serif text-4xl font-normal md:text-5xl">
						A private evidence package becomes a public truth record.
					</h2>
					<div className="mt-8 grid gap-4 md:grid-cols-3">
						{[
							[
								Inbox,
								"1. Evidence intake",
								"A one-use capability token issues signed S3 upload slots. The server hashes each artifact on arrival and seals a manifest without exposing source identity.",
							],
							[
								ScanSearch,
								"2. AI tribunal",
								"Internal-consistency, external-corroboration, and red-team agents run in parallel. Each cites artifact chunks and public sources.",
							],
							[
								Stamp,
								"3. Truth certificate",
								"A privacy-preserving truth certificate publishes tier, confidence, provenance, claim corroboration, red-team concerns, and attribution language.",
							],
						].map(([Icon, title, text]) => (
							<div
								className="border border-border bg-background p-5"
								key={title as string}
							>
								<Icon className="text-primary" size={26} />
								<h3 className="mt-3 font-serif text-xl font-bold">
									{title as string}
								</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">
									{text as string}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>
		</main>
	);
}
