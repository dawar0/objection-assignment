CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "private_source";
--> statement-breakpoint
CREATE TABLE "private_source"."artifact_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"embedded" boolean DEFAULT false NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"public_id" text PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"evidence_breakdown" jsonb NOT NULL,
	"concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution_snippets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"methodology_hash" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" text NOT NULL,
	"intake_ts" timestamp with time zone DEFAULT now() NOT NULL,
	"manifest_hash" text,
	"anchor_status" text DEFAULT 'pending' NOT NULL,
	"anchor_proof" jsonb,
	"file_refs" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_source"."source_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"sanitized_label" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"s3_object_key" text NOT NULL,
	"sha256" text,
	"raw_extracted_text" text,
	"extraction_status" text DEFAULT 'pending' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_intake_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"journalist_memo" text,
	"package_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_intake_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"methodology_version" text NOT NULL,
	"methodology_hash" text NOT NULL,
	"raw_findings_json" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"step_states" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "private_source"."artifact_chunks" ADD CONSTRAINT "artifact_chunks_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "private_source"."source_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_package_id_evidence_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."evidence_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD CONSTRAINT "source_artifacts_package_id_evidence_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."evidence_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_intake_links" ADD CONSTRAINT "source_intake_links_package_id_evidence_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."evidence_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_package_id_evidence_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."evidence_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_chunks_artifact_idx" ON "private_source"."artifact_chunks" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "source_artifacts_package_idx" ON "private_source"."source_artifacts" USING btree ("package_id");
