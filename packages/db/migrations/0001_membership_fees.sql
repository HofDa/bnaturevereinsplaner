ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TYPE "public"."fee_interval" AS ENUM('annual', 'once');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'other');--> statement-breakpoint
CREATE TABLE "finance_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_operations_key_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "finance_operation_hash_valid" CHECK ("finance_operations"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "membership_fee_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"due_date" date NOT NULL,
	"member_name" text NOT NULL,
	"membership_number" text NOT NULL,
	"plan_name" text NOT NULL,
	"interval" "fee_interval" NOT NULL,
	"plan_amount_cents" integer NOT NULL,
	"base_amount_cents" integer NOT NULL,
	"reduction_cents" integer DEFAULT 0 NOT NULL,
	"exempt" boolean DEFAULT false NOT NULL,
	"adjustment_reason" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_assessments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "fee_assessment_year_valid" CHECK ("membership_fee_assessments"."fiscal_year" between 1900 and 2200),
	CONSTRAINT "fee_assessment_amounts_valid" CHECK ("membership_fee_assessments"."plan_amount_cents" between 0 and 1000000000 and "membership_fee_assessments"."base_amount_cents" between 0 and 1000000000 and "membership_fee_assessments"."reduction_cents" between 0 and "membership_fee_assessments"."base_amount_cents" and "membership_fee_assessments"."amount_cents" between 0 and 1000000000),
	CONSTRAINT "fee_assessment_net_valid" CHECK ("membership_fee_assessments"."amount_cents"=case when "membership_fee_assessments"."exempt" then 0 else "membership_fee_assessments"."base_amount_cents"-"membership_fee_assessments"."reduction_cents" end),
	CONSTRAINT "fee_assessment_reason_valid" CHECK ((not "membership_fee_assessments"."exempt" and "membership_fee_assessments"."base_amount_cents"="membership_fee_assessments"."plan_amount_cents" and "membership_fee_assessments"."reduction_cents"=0) or length(trim("membership_fee_assessments"."adjustment_reason"))>0),
	CONSTRAINT "fee_assessment_exemption_valid" CHECK (not "membership_fee_assessments"."exempt" or "membership_fee_assessments"."reduction_cents"=0),
	CONSTRAINT "fee_assessment_currency_valid" CHECK ("membership_fee_assessments"."currency"='EUR')
);
--> statement-breakpoint
CREATE TABLE "membership_fee_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"interval" "fee_interval" NOT NULL,
	"membership_type" "membership_type",
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_plans_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "fee_plans_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "fee_plan_amount_valid" CHECK ("membership_fee_plans"."amount_cents" between 0 and 1000000000),
	CONSTRAINT "fee_plan_currency_valid" CHECK ("membership_fee_plans"."currency" = 'EUR'),
	CONSTRAINT "fee_plan_version_valid" CHECK ("membership_fee_plans"."version">0),
	CONSTRAINT "fee_plan_name_valid" CHECK (length(trim("membership_fee_plans"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "membership_fee_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"open_cents" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_reminders_sequence_unique" UNIQUE("organization_id","assessment_id","sequence"),
	CONSTRAINT "fee_reminder_amount_valid" CHECK ("membership_fee_reminders"."open_cents" between 1 and 1000000000),
	CONSTRAINT "fee_reminder_sequence_valid" CHECK ("membership_fee_reminders"."sequence">0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocation_pair_unique" UNIQUE("payment_id","assessment_id"),
	CONSTRAINT "payment_allocation_amount_valid" CHECK ("payment_allocations"."amount_cents" between 1 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_number" integer NOT NULL,
	"payer_name" text NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "payments_org_receipt_unique" UNIQUE("organization_id","receipt_number"),
	CONSTRAINT "payment_amount_valid" CHECK ("payments"."amount_cents" between 1 and 1000000000),
	CONSTRAINT "payment_currency_valid" CHECK ("payments"."currency"='EUR'),
	CONSTRAINT "payment_receipt_valid" CHECK ("payments"."receipt_number">0),
	CONSTRAINT "payment_payer_valid" CHECK (length(trim("payments"."payer_name")) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "finance_operations" ADD CONSTRAINT "finance_operations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_operations" ADD CONSTRAINT "finance_operations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_assessments" ADD CONSTRAINT "membership_fee_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_assessments" ADD CONSTRAINT "membership_fee_assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_assessments" ADD CONSTRAINT "membership_fee_assessments_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_assessments" ADD CONSTRAINT "membership_fee_assessments_organization_id_plan_id_membership_fee_plans_organization_id_id_fk" FOREIGN KEY ("organization_id","plan_id") REFERENCES "public"."membership_fee_plans"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_plans" ADD CONSTRAINT "membership_fee_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_reminders" ADD CONSTRAINT "membership_fee_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_reminders" ADD CONSTRAINT "membership_fee_reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_fee_reminders" ADD CONSTRAINT "membership_fee_reminders_organization_id_assessment_id_membership_fee_assessments_organization_id_id_fk" FOREIGN KEY ("organization_id","assessment_id") REFERENCES "public"."membership_fee_assessments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_payment_id_payments_organization_id_id_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_organization_id_assessment_id_membership_fee_assessments_organization_id_id_fk" FOREIGN KEY ("organization_id","assessment_id") REFERENCES "public"."membership_fee_assessments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_operations_org_created_idx" ON "finance_operations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_assessment_annual_unique" ON "membership_fee_assessments" USING btree ("organization_id","membership_id","plan_id","fiscal_year") WHERE "membership_fee_assessments"."interval"='annual';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_assessment_once_unique" ON "membership_fee_assessments" USING btree ("organization_id","membership_id","plan_id") WHERE "membership_fee_assessments"."interval"='once';--> statement-breakpoint
CREATE INDEX "fee_assessments_org_due_idx" ON "membership_fee_assessments" USING btree ("organization_id","fiscal_year","due_date");--> statement-breakpoint
CREATE INDEX "fee_assessments_membership_idx" ON "membership_fee_assessments" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "fee_plans_org_active_idx" ON "membership_fee_plans" USING btree ("organization_id","active");--> statement-breakpoint
CREATE INDEX "payment_allocations_assessment_idx" ON "payment_allocations" USING btree ("organization_id","assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_bank_reference_unique" ON "payments" USING btree ("organization_id","reference") WHERE "payments"."method"='bank_transfer' and "payments"."reference"<>'';--> statement-breakpoint
CREATE INDEX "payments_org_paid_idx" ON "payments" USING btree ("organization_id","paid_on");--> statement-breakpoint
-- Handwritten invariants: Drizzle CHECK constraints cannot aggregate child rows.
CREATE FUNCTION bnature_finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Posted finance records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fee_assessments_immutable BEFORE UPDATE OR DELETE ON membership_fee_assessments FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_immutable BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER finance_operations_immutable BEFORE UPDATE OR DELETE ON finance_operations FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER fee_reminders_immutable BEFORE UPDATE OR DELETE ON membership_fee_reminders FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_fee_plan_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM organizations WHERE id=OLD.organization_id FOR NO KEY UPDATE;
  IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid fee plan version or identity';
  END IF;
  IF NEW.interval<>OLD.interval AND EXISTS(SELECT 1 FROM membership_fee_assessments WHERE organization_id=OLD.organization_id AND plan_id=OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A used fee plan cannot change interval';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fee_plan_update_guard BEFORE UPDATE ON membership_fee_plans FOR EACH ROW EXECUTE FUNCTION bnature_fee_plan_update();
--> statement-breakpoint
CREATE FUNCTION bnature_assessment_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tariff membership_fee_plans%ROWTYPE; category membership_type;
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT * INTO tariff FROM membership_fee_plans WHERE organization_id=NEW.organization_id AND id=NEW.plan_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown fee plan'; END IF;
  SELECT membership_type INTO category FROM memberships WHERE organization_id=NEW.organization_id AND id=NEW.membership_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown membership'; END IF;
  IF NOT tariff.active OR NEW.interval<>tariff.interval OR NEW.plan_amount_cents<>tariff.amount_cents OR NEW.plan_name<>tariff.name OR (tariff.membership_type IS NOT NULL AND tariff.membership_type<>category) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid fee plan snapshot or category';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fee_assessment_insert_guard BEFORE INSERT ON membership_fee_assessments FOR EACH ROW EXECUTE FUNCTION bnature_assessment_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_allocation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_amount bigint; assessment_amount bigint; allocated bigint;
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT amount_cents INTO payment_amount FROM payments WHERE organization_id=NEW.organization_id AND id=NEW.payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown payment'; END IF;
  SELECT amount_cents INTO assessment_amount FROM membership_fee_assessments WHERE organization_id=NEW.organization_id AND id=NEW.assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown assessment'; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO allocated FROM payment_allocations WHERE organization_id=NEW.organization_id AND payment_id=NEW.payment_id;
  IF allocated+NEW.amount_cents>payment_amount THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment overallocated'; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO allocated FROM payment_allocations WHERE organization_id=NEW.organization_id AND assessment_id=NEW.assessment_id;
  IF allocated+NEW.amount_cents>assessment_amount THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assessment overpaid'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_allocation_insert_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION bnature_allocation_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_payment_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_uuid uuid; payment_amount bigint; allocated bigint;
BEGIN
  IF TG_TABLE_NAME='payments' THEN payment_uuid=NEW.id; ELSE payment_uuid=NEW.payment_id; END IF;
  SELECT amount_cents INTO payment_amount FROM payments WHERE organization_id=NEW.organization_id AND id=payment_uuid;
  SELECT COALESCE(sum(amount_cents),0) INTO allocated FROM payment_allocations WHERE organization_id=NEW.organization_id AND payment_id=payment_uuid;
  IF payment_amount IS NULL OR allocated<>payment_amount THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment must be fully allocated'; END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_balanced_after_insert AFTER INSERT ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bnature_payment_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocation_balanced_after_insert AFTER INSERT ON payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bnature_payment_balanced();
