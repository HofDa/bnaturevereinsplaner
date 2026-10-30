ALTER TABLE "cashbook_categories" DROP CONSTRAINT "cashbook_categories_org_name_unique";--> statement-breakpoint
ALTER TABLE "cashbook_categories" ADD COLUMN "starter_key" text;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD COLUMN "ets_definition_version" text;--> statement-breakpoint
ALTER TABLE "cashbook_categories" ADD CONSTRAINT "cashbook_categories_starter_key_unique" UNIQUE("organization_id","starter_key");--> statement-breakpoint
ALTER TABLE "cashbook_categories" ADD CONSTRAINT "cashbook_categories_org_name_unique" UNIQUE("organization_id","name","direction");--> statement-breakpoint
-- Snapshots also pin the reporting definition. Existing mapped rows were created with r1.
ALTER TABLE cashbook_entries DISABLE TRIGGER cashbook_entries_immutable;
UPDATE cashbook_entries SET ets_definition_version='ets-d2020-e2026-r1' WHERE ets_position IS NOT NULL;
UPDATE cashbook_entries e SET category_name=coalesce((SELECT o.response->>'categoryName' FROM finance_operations o WHERE o.organization_id=e.organization_id AND o.response->>'id'=e.id::text AND o.response ? 'categoryName' ORDER BY o.created_at LIMIT 1),e.category_name);
ALTER TABLE cashbook_entries ENABLE TRIGGER cashbook_entries_immutable;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION bnature_entry_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original cashbook_entries%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fiscal_years WHERE organization_id=NEW.organization_id AND year=NEW.fiscal_year AND NEW.booking_date BETWEEN starts_on AND ends_on) THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Booking date outside fiscal year'; END IF;
 IF NEW.reverses_entry_id IS NOT NULL THEN
 SELECT * INTO original FROM cashbook_entries WHERE organization_id=NEW.organization_id AND id=NEW.reverses_entry_id;
 NEW.category_name=original.category_name; NEW.ets_position=original.ets_position; NEW.ets_definition_version=original.ets_definition_version; NEW.project=original.project;
 ELSE
 SELECT name INTO NEW.category_name FROM cashbook_categories WHERE organization_id=NEW.organization_id AND id=NEW.category_id;
 SELECT position,definition_version INTO NEW.ets_position,NEW.ets_definition_version FROM category_ets_mappings WHERE organization_id=NEW.organization_id AND category_id=NEW.category_id AND effective_from<=NEW.booking_date ORDER BY effective_from DESC LIMIT 1;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE FUNCTION bnature_category_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Categories are deactivated, not deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.direction<>OLD.direction OR NEW.classification<>OLD.classification OR NEW.created_at<>OLD.created_at THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Category identity and classification are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER category_update_guard BEFORE UPDATE OR DELETE ON cashbook_categories FOR EACH ROW EXECUTE FUNCTION bnature_category_update();
--> statement-breakpoint
CREATE FUNCTION bnature_account_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Accounts are deactivated, not deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Account identity and kind are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER account_update_guard BEFORE UPDATE OR DELETE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION bnature_account_update();
--> statement-breakpoint
-- Preserve responses for requests replayed across the upgrade (years were calendar years).
ALTER TABLE finance_operations DISABLE TRIGGER finance_operations_immutable;
UPDATE finance_operations SET response=response||jsonb_build_object('startsOn',format('%s-01-01',response->>'year'),'endsOn',format('%s-12-31',response->>'year')) WHERE operation LIKE 'fiscal-years:%' AND response ? 'year' AND NOT response ? 'startsOn';
ALTER TABLE finance_operations ENABLE TRIGGER finance_operations_immutable;
