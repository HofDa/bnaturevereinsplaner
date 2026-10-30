CREATE TYPE "public"."attendance_status" AS ENUM('unrecorded', 'present', 'absent', 'excused');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('internal', 'members', 'public');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('registered', 'waitlisted', 'cancelled');--> statement-breakpoint
CREATE TABLE "attendance_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"previous_status" "attendance_status" NOT NULL,
	"status" "attendance_status" NOT NULL,
	"version" integer NOT NULL,
	"recorded_by" uuid NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_history_version" UNIQUE("organization_id","registration_id","version")
);
--> statement-breakpoint
CREATE TABLE "attendance_operations" (
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_occurrence_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"requested_status" "attendance_status" NOT NULL,
	"expected_version" integer NOT NULL,
	"client_created_at" timestamp with time zone NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_operations_organization_id_operation_id_pk" PRIMARY KEY("organization_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "event_attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_occurrence_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"status" "attendance_status" DEFAULT 'unrecorded' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"recorded_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_attendance_registration" UNIQUE("organization_id","registration_id"),
	CONSTRAINT "event_attendance_version" CHECK ("event_attendances"."version">=0)
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name_i18n" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"starter_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_categories_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "event_categories_starter" UNIQUE("organization_id","starter_key"),
	CONSTRAINT "event_category_names" CHECK (length(trim("event_categories"."name_i18n"->>'de'))>0 and length(trim("event_categories"."name_i18n"->>'it'))>0)
);
--> statement-breakpoint
CREATE TABLE "event_occurrence_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"original_start_at" timestamp with time zone NOT NULL,
	"exception_type" text NOT NULL,
	"override_data" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_exception_type" CHECK ("event_occurrence_exceptions"."exception_type" in ('skip','override'))
);
--> statement-breakpoint
CREATE TABLE "event_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"series_id" uuid,
	"original_start_at" timestamp with time zone,
	"title_i18n" jsonb NOT NULL,
	"description_i18n" jsonb NOT NULL,
	"category_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Europe/Rome' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"organizer_id" uuid NOT NULL,
	"project" text DEFAULT '' NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"visibility" "event_visibility" DEFAULT 'internal' NOT NULL,
	"registration_required" boolean DEFAULT true NOT NULL,
	"capacity" integer,
	"registration_deadline" timestamp with time zone,
	"waitlist_enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_occurrences_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "event_occurrences_series_start" UNIQUE("organization_id","series_id","original_start_at"),
	CONSTRAINT "event_occurrence_dates" CHECK ("event_occurrences"."end_at">"event_occurrences"."start_at" and ("event_occurrences"."registration_deadline" is null or "event_occurrences"."registration_deadline"<="event_occurrences"."start_at")),
	CONSTRAINT "event_occurrence_capacity" CHECK ("event_occurrences"."capacity" is null or "event_occurrences"."capacity" between 1 and 10000),
	CONSTRAINT "event_coordinates" CHECK (("event_occurrences"."latitude" is null and "event_occurrences"."longitude" is null) or ("event_occurrences"."latitude" between -90 and 90 and "event_occurrences"."longitude" between -180 and 180))
);
--> statement-breakpoint
CREATE TABLE "event_operations" (
	"organization_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_operations_organization_id_operation_id_pk" PRIMARY KEY("organization_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_occurrence_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "registration_status" NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_registration_person" UNIQUE("organization_id","event_occurrence_id","person_id"),
	CONSTRAINT "event_registration_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "event_registration_occurrence_id" UNIQUE("organization_id","event_occurrence_id","id"),
	CONSTRAINT "event_registration_cancelled" CHECK (("event_registrations"."status"='cancelled')=("event_registrations"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recurrence_rule" text NOT NULL,
	"timezone" text NOT NULL,
	"start_local" text NOT NULL,
	"end_local" text NOT NULL,
	"template" jsonb NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_series_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendance_history" ADD CONSTRAINT "attendance_history_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_history" ADD CONSTRAINT "attendance_history_organization_id_registration_id_event_registrations_organization_id_id_fk" FOREIGN KEY ("organization_id","registration_id") REFERENCES "public"."event_registrations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_history" ADD CONSTRAINT "attendance_history_organization_id_operation_id_attendance_operations_organization_id_operation_id_fk" FOREIGN KEY ("organization_id","operation_id") REFERENCES "public"."attendance_operations"("organization_id","operation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_operations" ADD CONSTRAINT "attendance_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_operations" ADD CONSTRAINT "attendance_operations_organization_id_event_occurrence_id_registration_id_event_registrations_organization_id_event_occurrence_id_id_fk" FOREIGN KEY ("organization_id","event_occurrence_id","registration_id") REFERENCES "public"."event_registrations"("organization_id","event_occurrence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendances" ADD CONSTRAINT "event_attendances_organization_id_event_occurrence_id_registration_id_event_registrations_organization_id_event_occurrence_id_id_fk" FOREIGN KEY ("organization_id","event_occurrence_id","registration_id") REFERENCES "public"."event_registrations"("organization_id","event_occurrence_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrence_exceptions" ADD CONSTRAINT "event_occurrence_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrence_exceptions" ADD CONSTRAINT "event_occurrence_exceptions_organization_id_series_id_event_series_organization_id_id_fk" FOREIGN KEY ("organization_id","series_id") REFERENCES "public"."event_series"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrence_exceptions" ADD CONSTRAINT "event_occurrence_exceptions_organization_id_occurrence_id_event_occurrences_organization_id_id_fk" FOREIGN KEY ("organization_id","occurrence_id") REFERENCES "public"."event_occurrences"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_organization_id_series_id_event_series_organization_id_id_fk" FOREIGN KEY ("organization_id","series_id") REFERENCES "public"."event_series"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_organization_id_category_id_event_categories_organization_id_id_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."event_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_organization_id_organizer_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","organizer_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_operations" ADD CONSTRAINT "event_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_operations" ADD CONSTRAINT "event_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_organization_id_event_occurrence_id_event_occurrences_organization_id_id_fk" FOREIGN KEY ("organization_id","event_occurrence_id") REFERENCES "public"."event_occurrences"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_exceptions_series" ON "event_occurrence_exceptions" USING btree ("organization_id","series_id");--> statement-breakpoint
CREATE INDEX "event_occurrences_dates" ON "event_occurrences" USING btree ("organization_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "event_occurrences_organizer" ON "event_occurrences" USING btree ("organization_id","organizer_id");--> statement-breakpoint
CREATE INDEX "event_waitlist_order" ON "event_registrations" USING btree ("organization_id","event_occurrence_id","status","registered_at","id");--> statement-breakpoint
-- PostgreSQL protects these invariants even when a caller bypasses application checks.
CREATE TRIGGER event_operations_immutable BEFORE UPDATE OR DELETE ON event_operations FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER attendance_operations_immutable BEFORE UPDATE OR DELETE ON attendance_operations FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER attendance_history_immutable BEFORE UPDATE OR DELETE ON attendance_history FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER event_exceptions_immutable BEFORE UPDATE OR DELETE ON event_occurrence_exceptions FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_event_registration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occurrence event_occurrences%ROWTYPE; occupied integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Registrations are cancelled, not deleted'; END IF;
 PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
 SELECT * INTO occurrence FROM event_occurrences WHERE organization_id=NEW.organization_id AND id=NEW.event_occurrence_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='Unknown occurrence'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.person_id<>OLD.person_id OR NEW.event_occurrence_id<>OLD.event_occurrence_id OR NEW.created_by<>OLD.created_by OR NEW.version<>OLD.version+1) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid registration identity/version';
 END IF;
 IF (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status<>'cancelled' AND occurrence.status<>'published' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Registrations require a published event';
 END IF;
 IF NEW.status='registered' THEN
  SELECT count(*) INTO occupied FROM event_registrations WHERE organization_id=NEW.organization_id AND event_occurrence_id=NEW.event_occurrence_id AND status='registered' AND id<>NEW.id;
  IF occurrence.capacity IS NOT NULL AND occupied>=occurrence.capacity THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Event capacity exceeded'; END IF;
 END IF;
 IF NEW.status='waitlisted' AND NOT occurrence.waitlist_enabled THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Waitlist disabled'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER event_registration_guard BEFORE INSERT OR UPDATE OR DELETE ON event_registrations FOR EACH ROW EXECUTE FUNCTION bnature_event_registration_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_event_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occupied integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Events are cancelled, not deleted'; END IF;
 PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.series_id IS DISTINCT FROM OLD.series_id OR NEW.original_start_at IS DISTINCT FROM OLD.original_start_at OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid event identity/version'; END IF;
 SELECT count(*) INTO occupied FROM event_registrations WHERE organization_id=NEW.organization_id AND event_occurrence_id=NEW.id AND status='registered';
 IF NEW.capacity IS NOT NULL AND NEW.capacity<occupied THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Capacity below confirmed registrations'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER event_occurrence_guard BEFORE UPDATE OR DELETE ON event_occurrences FOR EACH ROW EXECUTE FUNCTION bnature_event_occurrence_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attendance is corrected, not deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.registration_id<>OLD.registration_id OR NEW.event_occurrence_id<>OLD.event_occurrence_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.recorded_by IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid attendance identity/version'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER event_attendance_guard BEFORE UPDATE OR DELETE ON event_attendances FOR EACH ROW EXECUTE FUNCTION bnature_attendance_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_attendance_history_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM attendance_history h JOIN attendance_operations o ON o.organization_id=h.organization_id AND o.operation_id=h.operation_id WHERE h.organization_id=NEW.organization_id AND h.registration_id=NEW.registration_id AND h.version=NEW.version AND h.status=NEW.status AND h.recorded_by=NEW.recorded_by AND o.actor_user_id=NEW.recorded_by AND o.expected_version=OLD.version AND o.requested_status=NEW.status) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Attendance changes require an authorized operation and history'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER attendance_history_required AFTER UPDATE ON event_attendances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bnature_attendance_history_required();
