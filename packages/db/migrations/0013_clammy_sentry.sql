CREATE TABLE "mail_newsletters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_i18n" jsonb NOT NULL,
	"body_i18n" jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_newsletters_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "mail_newsletter_status" CHECK ("mail_newsletters"."status" in ('draft','sent','withdrawn')),
	CONSTRAINT "mail_newsletter_sent" CHECK (("mail_newsletters"."status"='sent')=("mail_newsletters"."sent_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_message_kind";--> statement-breakpoint
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_message_source";--> statement-breakpoint
ALTER TABLE "mail_messages" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "newsletter_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "deadline_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "newsletter_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "resolution_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "automatic_deadline_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "deadline_last_run_on" date;--> statement-breakpoint
ALTER TABLE "mail_newsletters" ADD CONSTRAINT "mail_newsletters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_newsletters" ADD CONSTRAINT "mail_newsletters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_newsletters_org_idx" ON "mail_newsletters" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_deadline_id_compliance_deadlines_organization_id_id_fk" FOREIGN KEY ("organization_id","deadline_id") REFERENCES "public"."compliance_deadlines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_newsletter_id_mail_newsletters_organization_id_id_fk" FOREIGN KEY ("organization_id","newsletter_id") REFERENCES "public"."mail_newsletters"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_user_idx" ON "mail_messages" USING btree ("user_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_secret" CHECK ("mail_messages"."secret_ciphertext" is null or "mail_messages"."kind" in ('account_invitation','password_reset'));--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_resolution" CHECK (("mail_messages"."resolution" is null) = ("mail_messages"."resolved_at" is null and "mail_messages"."resolved_by" is null) and ("mail_messages"."resolution" is null or "mail_messages"."resolution" in ('retry','mark_sent','dismiss')));--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_kind" CHECK ("mail_messages"."kind" in ('fee_reminder','event_invitation','deadline_reminder','newsletter','account_invitation','password_reset','test'));--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_source" CHECK (case "mail_messages"."kind"
        when 'fee_reminder' then "mail_messages"."person_id" is not null and "mail_messages"."assessment_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."event_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
        when 'event_invitation' then "mail_messages"."person_id" is not null and "mail_messages"."event_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."assessment_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
        when 'deadline_reminder' then "mail_messages"."user_id" is not null and "mail_messages"."deadline_id" is not null and num_nonnulls("mail_messages"."person_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."newsletter_id") = 0
        when 'newsletter' then "mail_messages"."person_id" is not null and "mail_messages"."newsletter_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."deadline_id") = 0
        else "mail_messages"."user_id" is not null and num_nonnulls("mail_messages"."person_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
      end);