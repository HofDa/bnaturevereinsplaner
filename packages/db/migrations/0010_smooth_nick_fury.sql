ALTER TABLE "event_occurrences" ADD COLUMN "cancellation_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_series" ADD COLUMN "cancellation_reason" text DEFAULT '' NOT NULL;