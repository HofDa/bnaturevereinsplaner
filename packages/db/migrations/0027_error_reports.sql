CREATE TABLE "error_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"stack" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"release" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "error_reports_fingerprint" UNIQUE("source","fingerprint"),
	CONSTRAINT "error_reports_source" CHECK ("error_reports"."source" in ('web','api'))
);
--> statement-breakpoint
CREATE INDEX "error_reports_last_seen" ON "error_reports" USING btree ("last_seen_at");