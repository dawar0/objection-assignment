import {
	boolean,
	customType,
	index,
	integer,
	jsonb,
	pgSchema,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[] }>({
	dataType() {
		return "vector(1536)";
	},
	toDriver(value) {
		return `[${value.join(",")}]`;
	},
});

export const sourceIntakeLinks = pgTable("source_intake_links", {
	id: uuid("id").defaultRandom().primaryKey(),
	tokenHash: text("token_hash").notNull().unique(),
	status: text("status").notNull().default("active"),
	caseMemo: text("journalist_memo"),
	packageId: uuid("package_id").references(() => evidencePackages.id),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	usedAt: timestamp("used_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const evidencePackages = pgTable("evidence_packages", {
	id: uuid("id").defaultRandom().primaryKey(),
	pseudonym: text("pseudonym").notNull(),
	intakeTs: timestamp("intake_ts", { withTimezone: true })
		.defaultNow()
		.notNull(),
	summarizationSealedAt: timestamp("summarization_sealed_at", {
		withTimezone: true,
	}),
	manifestHash: text("manifest_hash"),
	anchorStatus: text("anchor_status").notNull().default("pending"),
	anchorProof: jsonb("anchor_proof").$type<Record<string, unknown>>(),
	fileRefs: jsonb("file_refs")
		.$type<Array<Record<string, unknown>>>()
		.notNull()
		.default([]),
});

export const verificationRuns = pgTable("verification_runs", {
	id: uuid("id").defaultRandom().primaryKey(),
	packageId: uuid("package_id")
		.notNull()
		.references(() => evidencePackages.id),
	methodologyVersion: text("methodology_version").notNull(),
	methodologyHash: text("methodology_hash").notNull(),
	rawFindingsJson: jsonb("raw_findings_json").$type<Record<string, unknown>>(),
	status: text("status").notNull().default("queued"),
	stepStates: jsonb("step_states")
		.$type<Record<string, unknown>>()
		.notNull()
		.default({}),
	startedAt: timestamp("started_at", { withTimezone: true }),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const certificates = pgTable("certificates", {
	publicId: text("public_id").primaryKey(),
	packageId: uuid("package_id")
		.notNull()
		.references(() => evidencePackages.id),
	runId: uuid("run_id")
		.notNull()
		.references(() => verificationRuns.id),
	tier: text("tier").notNull(),
	evidenceBreakdown: jsonb("evidence_breakdown")
		.$type<Record<string, unknown>>()
		.notNull(),
	concerns: jsonb("concerns")
		.$type<Array<Record<string, unknown>>>()
		.notNull()
		.default([]),
	attributionSnippets: jsonb("attribution_snippets")
		.$type<Array<Record<string, unknown>>>()
		.notNull()
		.default([]),
	methodologyHash: text("methodology_hash").notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const privateSource = pgSchema("private_source");

export const sourceArtifacts = privateSource.table(
	"source_artifacts",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		packageId: uuid("package_id")
			.notNull()
			.references(() => evidencePackages.id),
		originalFilename: text("original_filename").notNull(),
		sanitizedLabel: text("sanitized_label").notNull(),
		mimeType: text("mime_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		s3ObjectKey: text("s3_object_key").notNull(),
		sha256: text("sha256"),
		rawExtractedText: text("raw_extracted_text"),
		extractionStatus: text("extraction_status").notNull().default("pending"),
		role: text("role"),
		processingSummary: text("processing_summary"),
		publicSafeSynopsis: text("public_safe_synopsis"),
		signals: jsonb("signals").$type<string[]>().notNull().default([]),
		limitations: jsonb("limitations").$type<string[]>().notNull().default([]),
		publicExcerpts: jsonb("public_excerpts")
			.$type<
				Array<{
					locator: string;
					text: string;
					citationType: "excerpt" | "paraphrase";
				}>
			>()
			.notNull()
			.default([]),
		summaryStatus: text("summary_status").notNull().default("pending"),
		metadataJson: jsonb("metadata_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("source_artifacts_package_idx").on(table.packageId)],
);

export const packageEntities = privateSource.table(
	"package_entities",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		packageId: uuid("package_id")
			.notNull()
			.references(() => evidencePackages.id),
		kind: text("kind").notNull(),
		realName: text("real_name").notNull(),
		pseudonym: text("pseudonym").notNull(),
		variants: jsonb("variants").$type<string[]>().notNull().default([]),
		firstSeenArtifactId: uuid("first_seen_artifact_id").references(
			() => sourceArtifacts.id,
		),
		mergeConfidence: text("merge_confidence").notNull().default("high"),
		mergeNotes: text("merge_notes"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("package_entities_package_idx").on(table.packageId),
		uniqueIndex("package_entities_real_name_uq").on(
			table.packageId,
			table.kind,
			table.realName,
		),
		uniqueIndex("package_entities_pseudonym_uq").on(
			table.packageId,
			table.pseudonym,
		),
	],
);

export const artifactChunks = privateSource.table(
	"artifact_chunks",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		artifactId: uuid("artifact_id")
			.notNull()
			.references(() => sourceArtifacts.id),
		chunkIndex: integer("chunk_index").notNull(),
		content: text("content").notNull(),
		contentHash: text("content_hash").notNull(),
		embedding: vector("embedding"),
		embedded: boolean("embedded").notNull().default(false),
		metadataJson: jsonb("metadata_json")
			.$type<Record<string, unknown>>()
			.notNull()
			.default({}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [index("artifact_chunks_artifact_idx").on(table.artifactId)],
);
