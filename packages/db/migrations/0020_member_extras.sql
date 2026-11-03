CREATE TABLE "member_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label_i18n" jsonb NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_field_definitions_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "member_field_type" CHECK ("member_field_definitions"."type" in ('text','number','date','boolean','select'))
);
--> statement-breakpoint
CREATE TABLE "person_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"decided_on" date NOT NULL,
	"given_by" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_consent_kind" CHECK ("person_consents"."kind" in ('data_processing','photos'))
);
--> statement-breakpoint
CREATE TABLE "person_field_values" (
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_field_values_person_id_field_id_pk" PRIMARY KEY("person_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "person_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_guardian_name" CHECK (length(trim("person_guardians"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "member_field_definitions" ADD CONSTRAINT "member_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_consents" ADD CONSTRAINT "person_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_consents" ADD CONSTRAINT "person_consents_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_field_values" ADD CONSTRAINT "person_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_field_values" ADD CONSTRAINT "person_field_values_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_field_values" ADD CONSTRAINT "person_field_values_organization_id_field_id_member_field_definitions_organization_id_id_fk" FOREIGN KEY ("organization_id","field_id") REFERENCES "public"."member_field_definitions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_guardians" ADD CONSTRAINT "person_guardians_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_field_definitions_org_idx" ON "member_field_definitions" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX "person_consents_person_idx" ON "person_consents" USING btree ("organization_id","person_id","kind","recorded_at");--> statement-breakpoint
CREATE INDEX "person_guardians_person_idx" ON "person_guardians" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE FUNCTION "person_consents_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Consent records are append-only' USING ERRCODE = '23514';
END $$;--> statement-breakpoint
CREATE TRIGGER "person_consents_append_only" BEFORE UPDATE OR DELETE ON "person_consents"
  FOR EACH ROW EXECUTE FUNCTION "person_consents_append_only"();
