CREATE TYPE "public"."finance_account_kind" AS ENUM('cash', 'bank');--> statement-breakpoint
CREATE TYPE "public"."fiscal_year_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ledger_classification" AS ENUM('membership_fee', 'donation', 'other');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "cashbook_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"classification" "ledger_classification" DEFAULT 'other' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbook_categories_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "cashbook_categories_org_id_direction_unique" UNIQUE("organization_id","id","direction"),
	CONSTRAINT "cashbook_categories_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "cashbook_category_name_valid" CHECK (length(trim("cashbook_categories"."name")) between 1 and 120),
	CONSTRAINT "cashbook_category_classification_valid" CHECK ("cashbook_categories"."direction"='income' or "cashbook_categories"."classification"='other'),
	CONSTRAINT "cashbook_category_version_valid" CHECK ("cashbook_categories"."version">0)
);
--> statement-breakpoint
CREATE TABLE "cashbook_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"entry_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount_cents" integer NOT NULL,
	"booking_date" date NOT NULL,
	"document_date" date NOT NULL,
	"document_number" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"counterparty" text DEFAULT '' NOT NULL,
	"payment_id" uuid,
	"reverses_entry_id" uuid,
	"reversal_reason" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbook_entries_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "cashbook_entries_number_unique" UNIQUE("organization_id","fiscal_year","entry_number"),
	CONSTRAINT "cashbook_entry_number_valid" CHECK ("cashbook_entries"."entry_number">0),
	CONSTRAINT "cashbook_entry_year_valid" CHECK (extract(year from "cashbook_entries"."booking_date")::integer="cashbook_entries"."fiscal_year"),
	CONSTRAINT "cashbook_entry_amount_valid" CHECK (("cashbook_entries"."reverses_entry_id" is null and "cashbook_entries"."amount_cents" between 1 and 1000000000 and "cashbook_entries"."reversal_reason"='') or ("cashbook_entries"."reverses_entry_id" is not null and "cashbook_entries"."amount_cents" between -1000000000 and -1 and length(trim("cashbook_entries"."reversal_reason"))>0)),
	CONSTRAINT "cashbook_entry_description_valid" CHECK (length(trim("cashbook_entries"."description")) between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "finance_account_kind" NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_accounts_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "finance_accounts_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "finance_account_name_valid" CHECK (length(trim("finance_accounts"."name")) between 1 and 120),
	CONSTRAINT "finance_account_version_valid" CHECK ("finance_accounts"."version">0)
);
--> statement-breakpoint
CREATE TABLE "finance_report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_key" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"valid_from_year" integer NOT NULL,
	"valid_to_year" integer,
	"revenue_threshold_cents" integer,
	"lines" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_templates_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "report_templates_version_unique" UNIQUE("organization_id","template_key","version"),
	CONSTRAINT "report_template_version_valid" CHECK ("finance_report_templates"."version">0),
	CONSTRAINT "report_template_name_valid" CHECK (length(trim("finance_report_templates"."name")) between 1 and 160),
	CONSTRAINT "report_template_years_valid" CHECK ("finance_report_templates"."valid_from_year" between 1900 and 2200 and ("finance_report_templates"."valid_to_year" is null or "finance_report_templates"."valid_to_year" between "finance_report_templates"."valid_from_year" and 2200)),
	CONSTRAINT "report_template_threshold_valid" CHECK ("finance_report_templates"."revenue_threshold_cents" is null or "finance_report_templates"."revenue_threshold_cents" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "fiscal_year_opening_balances" (
	"organization_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_year_opening_balances_organization_id_fiscal_year_account_id_pk" PRIMARY KEY("organization_id","fiscal_year","account_id"),
	CONSTRAINT "opening_balance_amount_valid" CHECK ("fiscal_year_opening_balances"."amount_cents" between -1000000000 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" "fiscal_year_status" DEFAULT 'open' NOT NULL,
	"opened_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_org_year_unique" UNIQUE("organization_id","year"),
	CONSTRAINT "fiscal_year_valid" CHECK ("fiscal_years"."year" between 1900 and 2200),
	CONSTRAINT "fiscal_year_closing_valid" CHECK (("fiscal_years"."status"='open' and "fiscal_years"."closed_by" is null and "fiscal_years"."closed_at" is null) or ("fiscal_years"."status"='closed' and "fiscal_years"."closed_by" is not null and "fiscal_years"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"reversed_on" date NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_payment_unique" UNIQUE("organization_id","payment_id"),
	CONSTRAINT "payment_reversal_reason_valid" CHECK (length(trim("payment_reversals"."reason")) between 1 and 500)
);
--> statement-breakpoint
DROP INDEX "payments_org_bank_reference_unique";--> statement-breakpoint
ALTER TABLE "cashbook_categories" ADD CONSTRAINT "cashbook_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_fiscal_year_fiscal_years_organization_id_year_fk" FOREIGN KEY ("organization_id","fiscal_year") REFERENCES "public"."fiscal_years"("organization_id","year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_account_id_finance_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."finance_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_category_id_direction_cashbook_categories_organization_id_id_direction_fk" FOREIGN KEY ("organization_id","category_id","direction") REFERENCES "public"."cashbook_categories"("organization_id","id","direction") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_payment_id_payments_organization_id_id_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_organization_id_reverses_entry_id_cashbook_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","reverses_entry_id") REFERENCES "public"."cashbook_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_report_templates" ADD CONSTRAINT "finance_report_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_report_templates" ADD CONSTRAINT "finance_report_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_opening_balances" ADD CONSTRAINT "fiscal_year_opening_balances_organization_id_fiscal_year_fiscal_years_organization_id_year_fk" FOREIGN KEY ("organization_id","fiscal_year") REFERENCES "public"."fiscal_years"("organization_id","year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_year_opening_balances" ADD CONSTRAINT "fiscal_year_opening_balances_organization_id_account_id_finance_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."finance_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_organization_id_payment_id_payments_organization_id_id_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cashbook_entries_payment_unique" ON "cashbook_entries" USING btree ("organization_id","payment_id") WHERE "cashbook_entries"."payment_id" is not null and "cashbook_entries"."reverses_entry_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cashbook_entries_reversal_unique" ON "cashbook_entries" USING btree ("organization_id","reverses_entry_id") WHERE "cashbook_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "cashbook_entries_org_date_idx" ON "cashbook_entries" USING btree ("organization_id","fiscal_year","booking_date");--> statement-breakpoint
CREATE INDEX "report_templates_org_key_idx" ON "finance_report_templates" USING btree ("organization_id","template_key");--> statement-breakpoint
CREATE INDEX "payments_org_reference_idx" ON "payments" USING btree ("organization_id","reference");--> statement-breakpoint
-- Handwritten ledger invariants. Writers also hold the organization row lock in the service layer.
CREATE TRIGGER fiscal_year_opening_balances_immutable BEFORE UPDATE OR DELETE ON fiscal_year_opening_balances FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER cashbook_entries_immutable BEFORE UPDATE OR DELETE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER payment_reversals_immutable BEFORE UPDATE OR DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE TRIGGER finance_report_templates_immutable BEFORE UPDATE OR DELETE ON finance_report_templates FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_fiscal_year_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Fiscal years cannot be deleted';
  END IF;
  IF OLD.status<>'open' OR NEW.status<>'closed' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.year<>OLD.year OR NEW.opened_by<>OLD.opened_by OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A fiscal year can only be closed once';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fiscal_year_update_guard BEFORE UPDATE OR DELETE ON fiscal_years FOR EACH ROW EXECUTE FUNCTION bnature_fiscal_year_update();
--> statement-breakpoint
CREATE FUNCTION bnature_opening_balance_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM fiscal_years WHERE organization_id=NEW.organization_id AND year=NEW.fiscal_year AND status='open' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Opening balances require an open fiscal year'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_balance_insert_guard BEFORE INSERT ON fiscal_year_opening_balances FOR EACH ROW EXECUTE FUNCTION bnature_opening_balance_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_cashbook_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE year_status fiscal_year_status; account_active boolean; category cashbook_categories%ROWTYPE; original cashbook_entries%ROWTYPE; payment_amount bigint;
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT status INTO year_status FROM fiscal_years WHERE organization_id=NEW.organization_id AND year=NEW.fiscal_year FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown fiscal year'; END IF;
  IF year_status<>'open' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Fiscal year is closed'; END IF;
  SELECT active INTO account_active FROM finance_accounts WHERE organization_id=NEW.organization_id AND id=NEW.account_id;
  SELECT * INTO category FROM cashbook_categories WHERE organization_id=NEW.organization_id AND id=NEW.category_id;
  IF account_active IS NULL OR category.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown account or category'; END IF;
  IF NEW.reverses_entry_id IS NULL THEN
    IF NOT account_active OR NOT category.active THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inactive account or category';
    END IF;
    IF NEW.payment_id IS NULL AND category.classification='membership_fee' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Membership fee income is booked from payments';
    END IF;
    IF NEW.payment_id IS NOT NULL THEN
      SELECT amount_cents INTO payment_amount FROM payments WHERE organization_id=NEW.organization_id AND id=NEW.payment_id FOR SHARE;
      IF payment_amount IS NULL OR payment_amount<>NEW.amount_cents OR NEW.direction<>'income' OR category.classification<>'membership_fee' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid payment booking';
      END IF;
      IF EXISTS(SELECT 1 FROM payment_reversals WHERE organization_id=NEW.organization_id AND payment_id=NEW.payment_id) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A reversed payment cannot be booked';
      END IF;
    END IF;
  ELSE
    SELECT * INTO original FROM cashbook_entries WHERE organization_id=NEW.organization_id AND id=NEW.reverses_entry_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown original entry'; END IF;
    IF original.reverses_entry_id IS NOT NULL OR NEW.amount_cents<>-original.amount_cents OR NEW.account_id<>original.account_id OR NEW.category_id<>original.category_id OR NEW.direction<>original.direction OR NEW.payment_id IS DISTINCT FROM original.payment_id OR NEW.booking_date<original.booking_date THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid reversal';
    END IF;
    IF original.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_reversals WHERE organization_id=NEW.organization_id AND payment_id=original.payment_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment bookings are reversed together with the payment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cashbook_entry_insert_guard BEFORE INSERT ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION bnature_cashbook_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_payment_reversal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(
    SELECT 1 FROM cashbook_entries e
    WHERE e.organization_id=NEW.organization_id AND e.payment_id=NEW.payment_id AND e.reverses_entry_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM cashbook_entries r WHERE r.organization_id=e.organization_id AND r.reverses_entry_id=e.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A booked payment reversal requires a cashbook reversal';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_reversal_balanced_after_insert AFTER INSERT ON payment_reversals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bnature_payment_reversal_balanced();
--> statement-breakpoint
CREATE FUNCTION bnature_payment_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.method='bank_transfer' AND NEW.reference<>'' THEN
    PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
    IF EXISTS(
      SELECT 1 FROM payments p
      WHERE p.organization_id=NEW.organization_id AND p.method='bank_transfer' AND p.reference=NEW.reference
        AND NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.organization_id=p.organization_id AND r.payment_id=p.id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Bank reference already posted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_reference_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION bnature_payment_reference();
--> statement-breakpoint
-- Reversed payments no longer count toward an assessment's paid amount.
CREATE OR REPLACE FUNCTION bnature_allocation_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment_amount bigint; assessment_amount bigint; allocated bigint;
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT amount_cents INTO payment_amount FROM payments WHERE organization_id=NEW.organization_id AND id=NEW.payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown payment'; END IF;
  IF EXISTS(SELECT 1 FROM payment_reversals WHERE organization_id=NEW.organization_id AND payment_id=NEW.payment_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment is reversed';
  END IF;
  SELECT amount_cents INTO assessment_amount FROM membership_fee_assessments WHERE organization_id=NEW.organization_id AND id=NEW.assessment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown assessment'; END IF;
  SELECT COALESCE(sum(amount_cents),0) INTO allocated FROM payment_allocations WHERE organization_id=NEW.organization_id AND payment_id=NEW.payment_id;
  IF allocated+NEW.amount_cents>payment_amount THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment overallocated'; END IF;
  SELECT COALESCE(sum(pa.amount_cents),0) INTO allocated FROM payment_allocations pa
    WHERE pa.organization_id=NEW.organization_id AND pa.assessment_id=NEW.assessment_id
      AND NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.organization_id=pa.organization_id AND r.payment_id=pa.payment_id);
  IF allocated+NEW.amount_cents>assessment_amount THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assessment overpaid'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION bnature_report_template_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest integer;
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
  SELECT max(version) INTO latest FROM finance_report_templates WHERE organization_id=NEW.organization_id AND template_key=NEW.template_key;
  IF NEW.version<>COALESCE(latest,0)+1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Report template versions are sequential';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER report_template_insert_guard BEFORE INSERT ON finance_report_templates FOR EACH ROW EXECUTE FUNCTION bnature_report_template_insert();
