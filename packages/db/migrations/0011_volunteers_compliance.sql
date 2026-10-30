CREATE TYPE "public"."volunteer_assignment_role" AS ENUM('helper', 'lead');--> statement-breakpoint
CREATE TYPE "public"."volunteer_assignment_status" AS ENUM('planned', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."compliance_kind" AS ENUM('legal', 'recommendation', 'internal');--> statement-breakpoint
CREATE TYPE "public"."compliance_topic" AS ENUM('runts_annual_report', 'organ_change', 'association_data', 'board_term', 'insurance', 'register_snapshot', 'document_review', 'custom');--> statement-breakpoint
CREATE TYPE "public"."compliance_deadline_status" AS ENUM('open', 'in_progress', 'done', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."volunteer_engagement_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."insurance_type" AS ENUM('accident', 'illness', 'liability');--> statement-breakpoint
CREATE TYPE "public"."insured_group" AS ENUM('regular', 'occasional', 'all', 'named');--> statement-breakpoint
CREATE TYPE "public"."insurance_policy_status" AS ENUM('draft', 'active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."volunteer_register_entry_type" AS ENUM('admission', 'exit', 'correction');--> statement-breakpoint
CREATE TYPE "public"."volunteer_register_section" AS ENUM('main', 'occasional');--> statement-breakpoint
CREATE TYPE "public"."volunteer_snapshot_status" AS ENUM('signature_pending', 'signature_imported', 'verified', 'verification_failed');--> statement-breakpoint
CREATE TYPE "public"."volunteer_time_source" AS ENUM('manual', 'attendance');--> statement-breakpoint
CREATE TYPE "public"."volunteer_time_status" AS ENUM('draft', 'submitted', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."volunteer_type" AS ENUM('regular', 'occasional');--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'register' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_media_type" ADD VALUE 'application/pkcs7-mime';--> statement-breakpoint
ALTER TYPE "public"."document_media_type" ADD VALUE 'application/timestamp-reply';--> statement-breakpoint
CREATE TABLE "compliance_deadline_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deadline_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" "compliance_deadline_status",
	"to_status" "compliance_deadline_status",
	"note" text DEFAULT '' NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_id" uuid,
	"rule_version" integer,
	"kind" "compliance_kind" NOT NULL,
	"topic" "compliance_topic" NOT NULL,
	"title_i18n" jsonb NOT NULL,
	"description_i18n" jsonb NOT NULL,
	"legal_basis" text DEFAULT '' NOT NULL,
	"responsible_role" "organization_role",
	"responsible_user_id" uuid,
	"source_key" text,
	"source_label" text DEFAULT '' NOT NULL,
	"due_date" date NOT NULL,
	"reminder_days" jsonb DEFAULT '[30,7]'::jsonb NOT NULL,
	"status" "compliance_deadline_status" DEFAULT 'open' NOT NULL,
	"completed_on" date,
	"completed_by" uuid,
	"protocol_number" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_deadlines_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "compliance_deadlines_source" UNIQUE("organization_id","source_key"),
	CONSTRAINT "compliance_deadline_done" CHECK (("compliance_deadlines"."status"='done')=("compliance_deadlines"."completed_on" is not null and "compliance_deadlines"."completed_by" is not null)),
	CONSTRAINT "compliance_deadline_rule" CHECK (("compliance_deadlines"."rule_id" is null)=("compliance_deadlines"."rule_version" is null))
);
--> statement-breakpoint
CREATE TABLE "compliance_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deadline_id" uuid NOT NULL,
	"document_id" uuid,
	"reference" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_evidence_present" CHECK ("compliance_evidence"."document_id" is not null or length(trim("compliance_evidence"."reference"))>0)
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"version" integer NOT NULL,
	"kind" "compliance_kind" NOT NULL,
	"topic" "compliance_topic" NOT NULL,
	"title_i18n" jsonb NOT NULL,
	"description_i18n" jsonb NOT NULL,
	"legal_basis" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"responsible_role" "organization_role",
	"calculation" jsonb NOT NULL,
	"reminder_days" jsonb DEFAULT '[30,7]'::jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"starter" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_rules_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "compliance_rules_version" UNIQUE("organization_id","rule_key","version"),
	CONSTRAINT "compliance_rule_dates" CHECK ("compliance_rules"."valid_to" is null or "compliance_rules"."valid_to">="compliance_rules"."valid_from"),
	CONSTRAINT "compliance_rule_legal" CHECK ("compliance_rules"."kind"<>'legal' or length(trim("compliance_rules"."legal_basis"))>0),
	CONSTRAINT "compliance_rule_version" CHECK ("compliance_rules"."version">0)
);
--> statement-breakpoint
CREATE TABLE "insurance_coverages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"covered_from" date NOT NULL,
	"covered_to" date,
	"notes" text DEFAULT '' NOT NULL,
	"end_reason" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_coverages_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "insurance_coverage_dates" CHECK ("insurance_coverages"."covered_to" is null or "insurance_coverages"."covered_to">="insurance_coverages"."covered_from")
);
--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"coverage_types" "insurance_type"[] NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"insured_group" "insured_group" DEFAULT 'all' NOT NULL,
	"insured_group_description" text DEFAULT '' NOT NULL,
	"status" "insurance_policy_status" DEFAULT 'active' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_policies_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "insurance_policies_number" UNIQUE("organization_id","insurer","policy_number"),
	CONSTRAINT "insurance_policy_dates" CHECK ("insurance_policies"."ends_on">="insurance_policies"."starts_on"),
	CONSTRAINT "insurance_policy_types" CHECK (cardinality("insurance_policies"."coverage_types") between 1 and 3 and array_position("insurance_policies"."coverage_types", null) is null),
	CONSTRAINT "insurance_policy_text" CHECK (length(trim("insurance_policies"."insurer")) between 1 and 200 and length(trim("insurance_policies"."policy_number")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "insurer_notification_items" (
	"organization_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	CONSTRAINT "insurer_notification_items_organization_id_notification_id_engagement_id_pk" PRIMARY KEY("organization_id","notification_id","engagement_id")
);
--> statement-breakpoint
CREATE TABLE "insurer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"notified_on" date NOT NULL,
	"method" text NOT NULL,
	"list_sha256" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurer_notifications_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "insurer_notification_hash" CHECK ("insurer_notifications"."list_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "volunteer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"event_occurrence_id" uuid,
	"role" "volunteer_assignment_role" DEFAULT 'helper' NOT NULL,
	"task" text NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone NOT NULL,
	"responsible_user_id" uuid,
	"project" text DEFAULT '' NOT NULL,
	"status" "volunteer_assignment_status" DEFAULT 'planned' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_assignments_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_assignments_engagement_id" UNIQUE("organization_id","engagement_id","id"),
	CONSTRAINT "volunteer_assignment_times" CHECK ("volunteer_assignments"."planned_end">"volunteer_assignments"."planned_start"),
	CONSTRAINT "volunteer_assignment_task" CHECK (length(trim("volunteer_assignments"."task")) between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "volunteer_engagement_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_engagement_history_version" UNIQUE("organization_id","engagement_id","version")
);
--> statement-breakpoint
CREATE TABLE "volunteer_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"volunteer_type" "volunteer_type" NOT NULL,
	"status" "volunteer_engagement_status" DEFAULT 'active' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"end_reason" text DEFAULT '' NOT NULL,
	"focus_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activity" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_engagements_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_engagement_dates" CHECK ("volunteer_engagements"."ended_on" is null or "volunteer_engagements"."ended_on">="volunteer_engagements"."started_on"),
	CONSTRAINT "volunteer_engagement_ended" CHECK (("volunteer_engagements"."status"='ended')=("volunteer_engagements"."ended_on" is not null)),
	CONSTRAINT "volunteer_engagement_focus" CHECK (jsonb_typeof("volunteer_engagements"."focus_areas")='array')
);
--> statement-breakpoint
CREATE TABLE "volunteer_register_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"section" "volunteer_register_section" NOT NULL,
	"entry_number" integer NOT NULL,
	"engagement_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"entry_type" "volunteer_register_entry_type" NOT NULL,
	"effective_date" date NOT NULL,
	"corrects_entry_id" uuid,
	"data" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"previous_hash" text,
	"entry_hash" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "volunteer_register_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_register_number" UNIQUE("organization_id","section","entry_number"),
	CONSTRAINT "volunteer_register_hash" UNIQUE("entry_hash"),
	CONSTRAINT "volunteer_register_number_valid" CHECK ("volunteer_register_entries"."entry_number">0),
	CONSTRAINT "volunteer_register_hash_valid" CHECK ("volunteer_register_entries"."entry_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "volunteer_register_correction" CHECK (("volunteer_register_entries"."entry_type"='correction')=("volunteer_register_entries"."corrects_entry_id" is not null) and ("volunteer_register_entries"."entry_type"<>'correction' or length(trim("volunteer_register_entries"."reason"))>0))
);
--> statement-breakpoint
CREATE TABLE "volunteer_register_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"occasional_section" boolean DEFAULT true NOT NULL,
	"signature_interval_days" integer DEFAULT 365 NOT NULL,
	"signature_procedure" text DEFAULT '' NOT NULL,
	"insurance_retention_years" integer DEFAULT 10 NOT NULL,
	"register_retention_years" integer DEFAULT 10 NOT NULL,
	"expiry_warning_days" integer DEFAULT 60 NOT NULL,
	"legal_approval_reference" text DEFAULT '' NOT NULL,
	"legal_approved_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_register_retention" CHECK ("volunteer_register_settings"."insurance_retention_years">=10 and "volunteer_register_settings"."register_retention_years">=10),
	CONSTRAINT "volunteer_register_interval" CHECK ("volunteer_register_settings"."signature_interval_days" between 1 and 366),
	CONSTRAINT "volunteer_register_approval" CHECK ("volunteer_register_settings"."legal_approved_on" is null or length(trim("volunteer_register_settings"."legal_approval_reference"))>0)
);
--> statement-breakpoint
CREATE TABLE "volunteer_register_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"snapshot_number" integer NOT NULL,
	"cutoff_date" date NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"main_last_number" integer NOT NULL,
	"occasional_last_number" integer NOT NULL,
	"main_count" integer NOT NULL,
	"occasional_count" integer NOT NULL,
	"payload_sha256" text NOT NULL,
	"sha256" text NOT NULL,
	"previous_snapshot_id" uuid,
	"previous_sha256" text,
	"document_id" uuid NOT NULL,
	"status" "volunteer_snapshot_status" DEFAULT 'signature_pending' NOT NULL,
	"signed_document_id" uuid,
	"timestamp_document_id" uuid,
	"technical_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_snapshots_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_snapshots_number" UNIQUE("organization_id","snapshot_number"),
	CONSTRAINT "volunteer_snapshots_previous" UNIQUE("organization_id","previous_snapshot_id"),
	CONSTRAINT "volunteer_snapshot_hashes" CHECK ("volunteer_register_snapshots"."sha256" ~ '^[0-9a-f]{64}$' and "volunteer_register_snapshots"."payload_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "volunteer_snapshot_chain" CHECK (("volunteer_register_snapshots"."snapshot_number"=1 and "volunteer_register_snapshots"."previous_snapshot_id" is null and "volunteer_register_snapshots"."previous_sha256" is null) or ("volunteer_register_snapshots"."snapshot_number">1 and "volunteer_register_snapshots"."previous_snapshot_id" is not null and "volunteer_register_snapshots"."previous_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "volunteer_snapshot_signed" CHECK ("volunteer_register_snapshots"."status"='signature_pending' or "volunteer_register_snapshots"."signed_document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "volunteer_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"assignment_id" uuid,
	"actual_start" timestamp with time zone NOT NULL,
	"actual_end" timestamp with time zone NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"minutes" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"project" text DEFAULT '' NOT NULL,
	"status" "volunteer_time_status" DEFAULT 'draft' NOT NULL,
	"source" "volunteer_time_source" DEFAULT 'manual' NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_time_entries_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "volunteer_time_order" CHECK ("volunteer_time_entries"."actual_end">"volunteer_time_entries"."actual_start"),
	CONSTRAINT "volunteer_time_length" CHECK ("volunteer_time_entries"."actual_end"-"volunteer_time_entries"."actual_start"<=interval '24 hours'),
	CONSTRAINT "volunteer_time_minutes" CHECK ("volunteer_time_entries"."break_minutes">=0 and "volunteer_time_entries"."minutes">0 and "volunteer_time_entries"."minutes"=floor(extract(epoch from ("volunteer_time_entries"."actual_end"-"volunteer_time_entries"."actual_start"))/60)::int-"volunteer_time_entries"."break_minutes"),
	CONSTRAINT "volunteer_time_confirmed" CHECK (("volunteer_time_entries"."status"='confirmed')=("volunteer_time_entries"."confirmed_by" is not null and "volunteer_time_entries"."confirmed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "volunteer_time_entry_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"previous" jsonb NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_time_history_version" UNIQUE("organization_id","time_entry_id","version")
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "birth_place" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "domicile" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "volunteer_engagement_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "insurance_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "insurer_notification_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "compliance_deadline_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_deadline_history" ADD CONSTRAINT "compliance_deadline_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadline_history" ADD CONSTRAINT "compliance_deadline_history_organization_id_deadline_id_compliance_deadlines_organization_id_id_fk" FOREIGN KEY ("organization_id","deadline_id") REFERENCES "public"."compliance_deadlines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_organization_id_rule_id_compliance_rules_organization_id_id_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."compliance_rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_organization_id_responsible_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","responsible_user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_organization_id_deadline_id_compliance_deadlines_organization_id_id_fk" FOREIGN KEY ("organization_id","deadline_id") REFERENCES "public"."compliance_deadlines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_evidence" ADD CONSTRAINT "compliance_evidence_organization_id_document_id_documents_organization_id_id_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_coverages" ADD CONSTRAINT "insurance_coverages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_coverages" ADD CONSTRAINT "insurance_coverages_organization_id_policy_id_insurance_policies_organization_id_id_fk" FOREIGN KEY ("organization_id","policy_id") REFERENCES "public"."insurance_policies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_coverages" ADD CONSTRAINT "insurance_coverages_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_notification_items" ADD CONSTRAINT "insurer_notification_items_organization_id_notification_id_insurer_notifications_organization_id_id_fk" FOREIGN KEY ("organization_id","notification_id") REFERENCES "public"."insurer_notifications"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_notification_items" ADD CONSTRAINT "insurer_notification_items_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_notifications" ADD CONSTRAINT "insurer_notifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_notifications" ADD CONSTRAINT "insurer_notifications_organization_id_policy_id_insurance_policies_organization_id_id_fk" FOREIGN KEY ("organization_id","policy_id") REFERENCES "public"."insurance_policies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_organization_id_event_occurrence_id_event_occurrences_organization_id_id_fk" FOREIGN KEY ("organization_id","event_occurrence_id") REFERENCES "public"."event_occurrences"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_assignments" ADD CONSTRAINT "volunteer_assignments_organization_id_responsible_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","responsible_user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_engagement_history" ADD CONSTRAINT "volunteer_engagement_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_engagement_history" ADD CONSTRAINT "volunteer_engagement_history_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_engagements" ADD CONSTRAINT "volunteer_engagements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_engagements" ADD CONSTRAINT "volunteer_engagements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_engagements" ADD CONSTRAINT "volunteer_engagements_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_entries" ADD CONSTRAINT "volunteer_register_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_entries" ADD CONSTRAINT "volunteer_register_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_entries" ADD CONSTRAINT "volunteer_register_entries_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_entries" ADD CONSTRAINT "volunteer_register_entries_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_entries" ADD CONSTRAINT "volunteer_register_entries_organization_id_corrects_entry_id_volunteer_register_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","corrects_entry_id") REFERENCES "public"."volunteer_register_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_settings" ADD CONSTRAINT "volunteer_register_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_settings" ADD CONSTRAINT "volunteer_register_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_organization_id_previous_snapshot_id_volunteer_register_snapshots_organization_id_id_fk" FOREIGN KEY ("organization_id","previous_snapshot_id") REFERENCES "public"."volunteer_register_snapshots"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_organization_id_document_id_documents_organization_id_id_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_organization_id_signed_document_id_documents_organization_id_id_fk" FOREIGN KEY ("organization_id","signed_document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_register_snapshots" ADD CONSTRAINT "volunteer_register_snapshots_organization_id_timestamp_document_id_documents_organization_id_id_fk" FOREIGN KEY ("organization_id","timestamp_document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entries" ADD CONSTRAINT "volunteer_time_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entries" ADD CONSTRAINT "volunteer_time_entries_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entries" ADD CONSTRAINT "volunteer_time_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entries" ADD CONSTRAINT "volunteer_time_entries_organization_id_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entries" ADD CONSTRAINT "volunteer_time_entries_organization_id_engagement_id_assignment_id_volunteer_assignments_organization_id_engagement_id_id_fk" FOREIGN KEY ("organization_id","engagement_id","assignment_id") REFERENCES "public"."volunteer_assignments"("organization_id","engagement_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entry_history" ADD CONSTRAINT "volunteer_time_entry_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_time_entry_history" ADD CONSTRAINT "volunteer_time_entry_history_organization_id_time_entry_id_volunteer_time_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","time_entry_id") REFERENCES "public"."volunteer_time_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_history_deadline" ON "compliance_deadline_history" USING btree ("organization_id","deadline_id","created_at");--> statement-breakpoint
CREATE INDEX "compliance_deadlines_due" ON "compliance_deadlines" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE INDEX "compliance_evidence_deadline" ON "compliance_evidence" USING btree ("organization_id","deadline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_rules_current" ON "compliance_rules" USING btree ("organization_id","rule_key") WHERE "compliance_rules"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "insurance_coverages_engagement" ON "insurance_coverages" USING btree ("organization_id","engagement_id");--> statement-breakpoint
CREATE INDEX "insurance_policies_dates" ON "insurance_policies" USING btree ("organization_id","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_assignments_event_once" ON "volunteer_assignments" USING btree ("organization_id","engagement_id","event_occurrence_id") WHERE "volunteer_assignments"."status"<>'cancelled' and "volunteer_assignments"."event_occurrence_id" is not null;--> statement-breakpoint
CREATE INDEX "volunteer_assignments_dates" ON "volunteer_assignments" USING btree ("organization_id","planned_start");--> statement-breakpoint
CREATE INDEX "volunteer_assignments_event" ON "volunteer_assignments" USING btree ("organization_id","event_occurrence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_engagements_open_person" ON "volunteer_engagements" USING btree ("organization_id","person_id") WHERE "volunteer_engagements"."ended_on" is null;--> statement-breakpoint
CREATE INDEX "volunteer_engagements_org_status" ON "volunteer_engagements" USING btree ("organization_id","status","volunteer_type");--> statement-breakpoint
CREATE INDEX "volunteer_register_engagement" ON "volunteer_register_entries" USING btree ("organization_id","engagement_id","entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_time_attendance_once" ON "volunteer_time_entries" USING btree ("organization_id","assignment_id") WHERE "volunteer_time_entries"."source"='attendance' and "volunteer_time_entries"."status"<>'rejected';--> statement-breakpoint
CREATE INDEX "volunteer_time_engagement" ON "volunteer_time_entries" USING btree ("organization_id","engagement_id","actual_start");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_volunteer_engagement_id_volunteer_engagements_organization_id_id_fk" FOREIGN KEY ("organization_id","volunteer_engagement_id") REFERENCES "public"."volunteer_engagements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_insurance_policy_id_insurance_policies_organization_id_id_fk" FOREIGN KEY ("organization_id","insurance_policy_id") REFERENCES "public"."insurance_policies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_insurer_notification_id_insurer_notifications_organization_id_id_fk" FOREIGN KEY ("organization_id","insurer_notification_id") REFERENCES "public"."insurer_notifications"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_compliance_deadline_id_compliance_deadlines_organization_id_id_fk" FOREIGN KEY ("organization_id","compliance_deadline_id") REFERENCES "public"."compliance_deadlines"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_volunteer_idx" ON "documents" USING btree ("organization_id","volunteer_engagement_id");--> statement-breakpoint
CREATE INDEX "documents_policy_idx" ON "documents" USING btree ("organization_id","insurance_policy_id");--> statement-breakpoint
-- Append-only records: history, statutory register entries, notifications and evidence.
CREATE TRIGGER volunteer_engagement_history_immutable BEFORE UPDATE OR DELETE ON volunteer_engagement_history FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER volunteer_time_history_immutable BEFORE UPDATE OR DELETE ON volunteer_time_entry_history FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER volunteer_register_entries_immutable BEFORE UPDATE OR DELETE ON volunteer_register_entries FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER insurer_notifications_immutable BEFORE UPDATE OR DELETE ON insurer_notifications FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER insurer_notification_items_immutable BEFORE UPDATE OR DELETE ON insurer_notification_items FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER compliance_evidence_immutable BEFORE UPDATE OR DELETE ON compliance_evidence FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER compliance_history_immutable BEFORE UPDATE OR DELETE ON compliance_deadline_history FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE=TG_TABLE_NAME||' rows are ended or cancelled, not deleted';
END; $$;
CREATE TRIGGER volunteer_engagements_no_delete BEFORE DELETE ON volunteer_engagements FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER volunteer_assignments_no_delete BEFORE DELETE ON volunteer_assignments FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER volunteer_time_entries_no_delete BEFORE DELETE ON volunteer_time_entries FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER insurance_policies_no_delete BEFORE DELETE ON insurance_policies FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER insurance_coverages_no_delete BEFORE DELETE ON insurance_coverages FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER compliance_deadlines_no_delete BEFORE DELETE ON compliance_deadlines FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER volunteer_settings_no_delete BEFORE DELETE ON volunteer_register_settings FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
--> statement-breakpoint
CREATE FUNCTION bnature_versioned_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid identity/version change';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_assignments_versioned BEFORE UPDATE ON volunteer_assignments FOR EACH ROW EXECUTE FUNCTION bnature_versioned_update();
CREATE TRIGGER insurance_policies_versioned BEFORE UPDATE ON insurance_policies FOR EACH ROW EXECUTE FUNCTION bnature_versioned_update();
--> statement-breakpoint
CREATE FUNCTION bnature_engagement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.person_id<>OLD.person_id OR NEW.volunteer_type<>OLD.volunteer_type OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid engagement identity/version';
 END IF;
 IF OLD.status='ended' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Ended engagements are final'; END IF;
 IF NEW.started_on<>OLD.started_on AND EXISTS(SELECT 1 FROM volunteer_register_entries WHERE organization_id=OLD.organization_id AND engagement_id=OLD.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Registered start dates are corrected in the register';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_engagement_guard BEFORE UPDATE ON volunteer_engagements FOR EACH ROW EXECUTE FUNCTION bnature_engagement_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_assignment_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='cancelled' THEN RETURN NEW; END IF;
 PERFORM 1 FROM volunteer_engagements WHERE organization_id=NEW.organization_id AND id=NEW.engagement_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM volunteer_assignments a WHERE a.organization_id=NEW.organization_id AND a.engagement_id=NEW.engagement_id AND a.id<>NEW.id AND a.status<>'cancelled' AND tstzrange(a.planned_start,a.planned_end)&&tstzrange(NEW.planned_start,NEW.planned_end)) THEN
  RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Overlapping volunteer assignment';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_assignment_overlap BEFORE INSERT OR UPDATE ON volunteer_assignments FOR EACH ROW EXECUTE FUNCTION bnature_assignment_overlap();
--> statement-breakpoint
CREATE FUNCTION bnature_time_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.engagement_id<>OLD.engagement_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.source<>OLD.source OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid time entry identity/version';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM volunteer_time_entry_history h WHERE h.organization_id=NEW.organization_id AND h.time_entry_id=NEW.id AND h.version=OLD.version) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Time entry changes require a history record';
  END IF;
 END IF;
 IF NEW.status='rejected' THEN RETURN NEW; END IF;
 PERFORM 1 FROM volunteer_engagements WHERE organization_id=NEW.organization_id AND id=NEW.engagement_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM volunteer_time_entries e WHERE e.organization_id=NEW.organization_id AND e.engagement_id=NEW.engagement_id AND e.id<>NEW.id AND e.status<>'rejected' AND tstzrange(e.actual_start,e.actual_end)&&tstzrange(NEW.actual_start,NEW.actual_end)) THEN
  RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Overlapping volunteer time entry';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_time_entry_guard BEFORE INSERT OR UPDATE ON volunteer_time_entries FOR EACH ROW EXECUTE FUNCTION bnature_time_entry_guard();
--> statement-breakpoint
-- Register numbering and hash chaining are verified against the previous entry of the same section.
CREATE FUNCTION bnature_register_entry_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last volunteer_register_entries%ROWTYPE;
BEGIN
 PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
 SELECT * INTO last FROM volunteer_register_entries WHERE organization_id=NEW.organization_id AND section=NEW.section ORDER BY entry_number DESC LIMIT 1;
 IF (last.id IS NULL AND (NEW.entry_number<>1 OR NEW.previous_hash IS NOT NULL)) OR (last.id IS NOT NULL AND (NEW.entry_number<>last.entry_number+1 OR NEW.previous_hash IS DISTINCT FROM last.entry_hash)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Register entries must be consecutive and chained';
 END IF;
 IF NEW.corrects_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM volunteer_register_entries WHERE organization_id=NEW.organization_id AND id=NEW.corrects_entry_id AND engagement_id=NEW.engagement_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Corrections must refer to an entry of the same engagement';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_register_entry_insert BEFORE INSERT ON volunteer_register_entries FOR EACH ROW EXECUTE FUNCTION bnature_register_entry_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last volunteer_register_snapshots%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Register snapshots are permanent'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT * INTO last FROM volunteer_register_snapshots WHERE organization_id=NEW.organization_id ORDER BY snapshot_number DESC LIMIT 1;
  IF (last.id IS NULL AND NEW.snapshot_number<>1) OR (last.id IS NOT NULL AND (NEW.snapshot_number<>last.snapshot_number+1 OR NEW.previous_snapshot_id<>last.id OR NEW.previous_sha256<>last.sha256 OR NEW.cutoff_date<last.cutoff_date)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Snapshots must be consecutive and chained';
  END IF;
  IF NEW.status<>'signature_pending' OR NEW.signed_document_id IS NOT NULL OR NEW.timestamp_document_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='New snapshots await an external signature';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.snapshot_number<>OLD.snapshot_number OR NEW.cutoff_date<>OLD.cutoff_date OR NEW.generated_at<>OLD.generated_at OR NEW.main_last_number<>OLD.main_last_number OR NEW.occasional_last_number<>OLD.occasional_last_number OR NEW.main_count<>OLD.main_count OR NEW.occasional_count<>OLD.occasional_count OR NEW.payload_sha256<>OLD.payload_sha256 OR NEW.sha256<>OLD.sha256 OR NEW.previous_snapshot_id IS DISTINCT FROM OLD.previous_snapshot_id OR NEW.previous_sha256 IS DISTINCT FROM OLD.previous_sha256 OR NEW.document_id<>OLD.document_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Finalized snapshot content is immutable';
 END IF;
 IF OLD.status='verified' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verified snapshots are final'; END IF;
 IF OLD.signed_document_id IS NOT NULL AND NEW.signed_document_id IS DISTINCT FROM OLD.signed_document_id AND OLD.status<>'verification_failed' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Signed files are replaced only after a failed verification';
 END IF;
 IF NOT ((OLD.status='signature_pending' AND NEW.status IN ('signature_pending','signature_imported'))
   OR (OLD.status='signature_imported' AND NEW.status IN ('signature_imported','verified','verification_failed'))
   OR (OLD.status='verification_failed' AND NEW.status IN ('verification_failed','signature_imported'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid snapshot status transition';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER volunteer_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON volunteer_register_snapshots FOR EACH ROW EXECUTE FUNCTION bnature_snapshot_guard();
--> statement-breakpoint
-- Register exports are immutable files: no second version, no relabelling.
CREATE FUNCTION bnature_register_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='document_versions' THEN
  IF NEW.version_number>1 AND EXISTS(SELECT 1 FROM documents WHERE organization_id=NEW.organization_id AND id=NEW.document_id AND category='register') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Register documents cannot receive new versions';
  END IF;
  RETURN NEW;
 END IF;
 IF (OLD.category='register' OR NEW.category='register') AND (NEW.category<>OLD.category OR NEW.archived<>OLD.archived) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Register documents are permanent';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER register_document_version_guard BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION bnature_register_document_guard();
CREATE TRIGGER register_document_guard BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION bnature_register_document_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Rule versions are permanent'; END IF;
 IF (to_jsonb(NEW)-'valid_to'-'active'-'review_note')<>(to_jsonb(OLD)-'valid_to'-'active'-'review_note') OR (OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Rule versions are immutable; create a new version';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER compliance_rule_guard BEFORE UPDATE OR DELETE ON compliance_rules FOR EACH ROW EXECUTE FUNCTION bnature_rule_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_deadline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.rule_version IS DISTINCT FROM OLD.rule_version OR NEW.source_key IS DISTINCT FROM OLD.source_key OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid deadline identity/version';
 END IF;
 IF OLD.status='done' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed deadlines are final'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER compliance_deadline_guard BEFORE UPDATE ON compliance_deadlines FOR EACH ROW EXECUTE FUNCTION bnature_deadline_guard();
CREATE FUNCTION bnature_deadline_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='done' AND NOT EXISTS(SELECT 1 FROM compliance_evidence WHERE organization_id=NEW.organization_id AND deadline_id=NEW.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed deadlines require documented evidence';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER compliance_deadline_evidence AFTER INSERT OR UPDATE ON compliance_deadlines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bnature_deadline_evidence();
