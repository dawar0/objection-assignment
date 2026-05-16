CREATE TABLE "private_source"."package_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"real_name" text NOT NULL,
	"pseudonym" text NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_artifact_id" uuid,
	"merge_confidence" text DEFAULT 'high' NOT NULL,
	"merge_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_packages" ADD COLUMN "summarization_sealed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "processing_summary" text;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "public_safe_synopsis" text;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "limitations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "public_excerpts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "private_source"."source_artifacts" ADD COLUMN "summary_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "private_source"."package_entities" ADD CONSTRAINT "package_entities_package_id_evidence_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."evidence_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_source"."package_entities" ADD CONSTRAINT "package_entities_first_seen_artifact_id_source_artifacts_id_fk" FOREIGN KEY ("first_seen_artifact_id") REFERENCES "private_source"."source_artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_entities_package_idx" ON "private_source"."package_entities" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_entities_real_name_uq" ON "private_source"."package_entities" USING btree ("package_id","kind","real_name");--> statement-breakpoint
CREATE UNIQUE INDEX "package_entities_pseudonym_uq" ON "private_source"."package_entities" USING btree ("package_id","pseudonym");