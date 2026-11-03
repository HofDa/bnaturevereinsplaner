CREATE TABLE "community_schedule_answers" (
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_schedule_answers_slot_id_user_id_pk" PRIMARY KEY("slot_id","user_id"),
	CONSTRAINT "community_schedule_answer" CHECK ("community_schedule_answers"."answer" in ('yes','maybe','no'))
);
--> statement-breakpoint
CREATE TABLE "community_schedule_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "community_schedule_slots_scope" UNIQUE("organization_id","schedule_id","id"),
	CONSTRAINT "community_schedule_slots_position" UNIQUE("schedule_id","position"),
	CONSTRAINT "community_schedule_slot_time" CHECK ("community_schedule_slots"."end_at">"community_schedule_slots"."start_at")
);
--> statement-breakpoint
CREATE TABLE "community_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid,
	"title_i18n" jsonb NOT NULL,
	"description_i18n" jsonb NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone,
	"final_slot_id" uuid,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_schedules_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "community_schedule_state" CHECK ("community_schedules"."state" in ('open','closed','archived')),
	CONSTRAINT "community_schedule_closed" CHECK (("community_schedules"."state"='open') = ("community_schedules"."closed_at" is null) and ("community_schedules"."final_slot_id" is null or "community_schedules"."state"<>'open')),
	CONSTRAINT "community_schedule_version" CHECK ("community_schedules"."version">0)
);
--> statement-breakpoint
ALTER TABLE "community_schedule_answers" ADD CONSTRAINT "community_schedule_answers_organization_id_schedule_id_slot_id_community_schedule_slots_organization_id_schedule_id_id_fk" FOREIGN KEY ("organization_id","schedule_id","slot_id") REFERENCES "public"."community_schedule_slots"("organization_id","schedule_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_schedule_answers" ADD CONSTRAINT "community_schedule_answers_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_schedule_slots" ADD CONSTRAINT "community_schedule_slots_organization_id_schedule_id_community_schedules_organization_id_id_fk" FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."community_schedules"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_schedules" ADD CONSTRAINT "community_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_schedules" ADD CONSTRAINT "community_schedules_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_schedules" ADD CONSTRAINT "community_schedules_organization_id_created_by_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_schedule_answers_schedule" ON "community_schedule_answers" USING btree ("organization_id","schedule_id");--> statement-breakpoint
CREATE INDEX "community_schedules_org_state" ON "community_schedules" USING btree ("organization_id","state","created_at");--> statement-breakpoint
ALTER TABLE "community_schedules" ADD CONSTRAINT "community_schedules_final_slot_fk" FOREIGN KEY ("organization_id","id","final_slot_id") REFERENCES "public"."community_schedule_slots"("organization_id","schedule_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
-- Answers are only accepted while the schedule is open and before its deadline.
CREATE FUNCTION "community_schedule_answer_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "community_schedules"
    WHERE "organization_id" = NEW."organization_id" AND "id" = NEW."schedule_id"
      AND "state" = 'open' AND ("closes_at" IS NULL OR "closes_at" > now())
  ) THEN
    RAISE EXCEPTION 'Scheduling poll is closed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "community_schedule_answer_guard" BEFORE INSERT OR UPDATE ON "community_schedule_answers"
  FOR EACH ROW EXECUTE FUNCTION "community_schedule_answer_guard"();
