ALTER TYPE "public"."document_category" ADD VALUE 'invoice' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'insurance' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."document_category" ADD VALUE 'funding' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "category_ets_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"position" text NOT NULL,
	"definition_version" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_ets_mappings_date_unique" UNIQUE("organization_id","category_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "ledger_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"booking_date" date NOT NULL,
	"description" text NOT NULL,
	"reverses_transfer_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transfers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "ledger_transfers_reversal_unique" UNIQUE("organization_id","reverses_transfer_id"),
	CONSTRAINT "ledger_transfer_accounts_different" CHECK ("ledger_transfers"."from_account_id"<>"ledger_transfers"."to_account_id"),
	CONSTRAINT "ledger_transfer_amount_valid" CHECK ("ledger_transfers"."amount_cents" between 1 and 1000000000),
	CONSTRAINT "ledger_transfer_description_valid" CHECK (length(trim("ledger_transfers"."description")) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "cashbook_entries" DROP CONSTRAINT "cashbook_entry_year_valid";--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD COLUMN "category_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD COLUMN "project" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD COLUMN "ets_position" text;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "category_ets_mappings" ADD CONSTRAINT "category_ets_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_ets_mappings" ADD CONSTRAINT "category_ets_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_ets_mappings" ADD CONSTRAINT "category_ets_mappings_organization_id_category_id_cashbook_categories_organization_id_id_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."cashbook_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_organization_id_fiscal_year_fiscal_years_organization_id_year_fk" FOREIGN KEY ("organization_id","fiscal_year") REFERENCES "public"."fiscal_years"("organization_id","year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_organization_id_from_account_id_finance_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","from_account_id") REFERENCES "public"."finance_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_organization_id_to_account_id_finance_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","to_account_id") REFERENCES "public"."finance_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_organization_id_reverses_transfer_id_ledger_transfers_organization_id_id_fk" FOREIGN KEY ("organization_id","reverses_transfer_id") REFERENCES "public"."ledger_transfers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_transfers_org_year_idx" ON "ledger_transfers" USING btree ("organization_id","fiscal_year");--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_year_dates_valid" CHECK ("fiscal_years"."starts_on" <= "fiscal_years"."ends_on");
--> statement-breakpoint
ALTER TABLE fiscal_years DISABLE TRIGGER fiscal_year_update_guard;
UPDATE fiscal_years SET starts_on=make_date(year,1,1), ends_on=make_date(year,12,31);
ALTER TABLE fiscal_years ENABLE TRIGGER fiscal_year_update_guard;
ALTER TABLE fiscal_years ALTER COLUMN starts_on SET NOT NULL, ALTER COLUMN ends_on SET NOT NULL;
ALTER TABLE cashbook_entries DISABLE TRIGGER cashbook_entries_immutable;
UPDATE cashbook_entries e SET category_name=c.name FROM cashbook_categories c WHERE c.organization_id=e.organization_id AND c.id=e.category_id;
ALTER TABLE cashbook_entries ENABLE TRIGGER cashbook_entries_immutable;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bnature_fiscal_year_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fiscal years cannot be deleted'; END IF;
 IF OLD.status<>'open' OR NEW.status<>'closed' OR (to_jsonb(NEW)-'status'-'closed_by'-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'closed_by'-'closed_at') THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A fiscal year can only be closed once'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE FUNCTION bnature_fiscal_dates_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM fiscal_years WHERE organization_id=NEW.organization_id AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fiscal years overlap'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fiscal_dates_insert_guard BEFORE INSERT ON fiscal_years FOR EACH ROW EXECUTE FUNCTION bnature_fiscal_dates_insert();
--> statement-breakpoint
CREATE FUNCTION bnature_entry_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original cashbook_entries%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fiscal_years WHERE organization_id=NEW.organization_id AND year=NEW.fiscal_year AND NEW.booking_date BETWEEN starts_on AND ends_on) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking date outside fiscal year'; END IF;
 IF NEW.reverses_entry_id IS NOT NULL THEN
 SELECT * INTO original FROM cashbook_entries WHERE organization_id=NEW.organization_id AND id=NEW.reverses_entry_id;
 NEW.category_name=original.category_name; NEW.ets_position=original.ets_position; NEW.project=original.project;
 ELSE
 SELECT name INTO NEW.category_name FROM cashbook_categories WHERE organization_id=NEW.organization_id AND id=NEW.category_id;
 SELECT position INTO NEW.ets_position FROM category_ets_mappings WHERE organization_id=NEW.organization_id AND category_id=NEW.category_id AND effective_from<=NEW.booking_date ORDER BY effective_from DESC LIMIT 1;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER entry_snapshot_guard BEFORE INSERT ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION bnature_entry_snapshot();
--> statement-breakpoint
CREATE TRIGGER category_ets_mappings_immutable BEFORE UPDATE OR DELETE ON category_ets_mappings FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
CREATE TRIGGER ledger_transfers_immutable BEFORE UPDATE OR DELETE ON ledger_transfers FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_transfer_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original ledger_transfers%ROWTYPE;
BEGIN
 PERFORM 1 FROM organizations WHERE id=NEW.organization_id FOR NO KEY UPDATE;
 PERFORM 1 FROM fiscal_years WHERE organization_id=NEW.organization_id AND year=NEW.fiscal_year AND status='open' AND NEW.booking_date BETWEEN starts_on AND ends_on FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer requires open fiscal year'; END IF;
 IF NEW.reverses_transfer_id IS NULL THEN
  IF (SELECT count(*) FROM finance_accounts WHERE organization_id=NEW.organization_id AND id IN (NEW.from_account_id,NEW.to_account_id) AND active)<>2 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Transfer requires active accounts'; END IF;
 ELSE
  SELECT * INTO original FROM ledger_transfers WHERE organization_id=NEW.organization_id AND id=NEW.reverses_transfer_id FOR SHARE;
  IF NOT FOUND OR original.reverses_transfer_id IS NOT NULL OR NEW.from_account_id<>original.to_account_id OR NEW.to_account_id<>original.from_account_id OR NEW.amount_cents<>original.amount_cents OR NEW.booking_date<original.booking_date THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid transfer reversal'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ledger_transfer_insert_guard BEFORE INSERT ON ledger_transfers FOR EACH ROW EXECUTE FUNCTION bnature_transfer_insert();
