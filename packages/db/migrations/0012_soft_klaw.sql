CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"person_id" uuid NOT NULL,
	"assessment_id" uuid,
	"event_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"language" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "mail_messages_org_dedupe" UNIQUE("organization_id","dedupe_key"),
	CONSTRAINT "mail_message_kind" CHECK ("mail_messages"."kind" in ('fee_reminder','event_invitation')),
	CONSTRAINT "mail_message_source" CHECK (("mail_messages"."kind"='fee_reminder' and "mail_messages"."assessment_id" is not null and "mail_messages"."event_id" is null) or ("mail_messages"."kind"='event_invitation' and "mail_messages"."assessment_id" is null and "mail_messages"."event_id" is not null)),
	CONSTRAINT "mail_message_state" CHECK ("mail_messages"."state" in ('queued','sending','sent','failed','uncertain','cancelled')),
	CONSTRAINT "mail_message_language" CHECK ("mail_messages"."language" in ('de','it')),
	CONSTRAINT "mail_message_subject" CHECK (length("mail_messages"."subject") between 1 and 500 and "mail_messages"."subject" !~ E'[\r\n]')
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"automatic_fee_reminders" boolean DEFAULT false NOT NULL,
	"reminder_interval_days" integer DEFAULT 14 NOT NULL,
	"enabled_by" uuid NOT NULL,
	"last_run_on" date,
	CONSTRAINT "mail_reminder_interval" CHECK ("mail_settings"."reminder_interval_days" between 7 and 90)
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_assessment_id_membership_fee_assessments_organization_id_id_fk" FOREIGN KEY ("organization_id","assessment_id") REFERENCES "public"."membership_fee_assessments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_event_id_event_occurrences_organization_id_id_fk" FOREIGN KEY ("organization_id","event_id") REFERENCES "public"."event_occurrences"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_enabled_by_users_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_queue_idx" ON "mail_messages" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "mail_messages_org_idx" ON "mail_messages" USING btree ("organization_id","created_at");