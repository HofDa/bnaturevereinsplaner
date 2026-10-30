CREATE TYPE "public"."inventory_condition" AS ENUM('new', 'good', 'worn', 'damaged', 'defective');--> statement-breakpoint
CREATE TYPE "public"."inventory_item_status" AS ENUM('active', 'retired');--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_number" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"condition" "inventory_condition" DEFAULT 'good' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"purchased_on" date,
	"value_cents" integer,
	"notes" text DEFAULT '' NOT NULL,
	"status" "inventory_item_status" DEFAULT 'active' NOT NULL,
	"retired_on" date,
	"retired_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_item_name" CHECK (length(trim("inventory_items"."name")) between 1 and 200),
	CONSTRAINT "inventory_item_quantity" CHECK ("inventory_items"."quantity" between 1 and 100000),
	CONSTRAINT "inventory_item_value" CHECK ("inventory_items"."value_cents" is null or "inventory_items"."value_cents" >= 0),
	CONSTRAINT "inventory_item_retired" CHECK (("inventory_items"."status"='retired') = ("inventory_items"."retired_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "inventory_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"issue_condition" "inventory_condition" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"returned_on" date,
	"return_condition" "inventory_condition",
	"return_notes" text DEFAULT '' NOT NULL,
	"returned_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_loans_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_loan_quantity" CHECK ("inventory_loans"."quantity" between 1 and 100000),
	CONSTRAINT "inventory_loan_due" CHECK ("inventory_loans"."due_on" >= "inventory_loans"."issued_on"),
	CONSTRAINT "inventory_loan_return" CHECK (("inventory_loans"."returned_on" is null) = ("inventory_loans"."return_condition" is null) and ("inventory_loans"."returned_on" is null) = ("inventory_loans"."returned_by" is null) and ("inventory_loans"."returned_on" is null or "inventory_loans"."returned_on" >= "inventory_loans"."issued_on"))
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_item_id_inventory_items_organization_id_id_fk" FOREIGN KEY ("organization_id","item_id") REFERENCES "public"."inventory_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_number" ON "inventory_items" USING btree ("organization_id","inventory_number") WHERE "inventory_items"."inventory_number" <> '';--> statement-breakpoint
CREATE INDEX "inventory_items_org_name" ON "inventory_items" USING btree ("organization_id","status","name");--> statement-breakpoint
CREATE INDEX "inventory_loans_item" ON "inventory_loans" USING btree ("organization_id","item_id","returned_on");--> statement-breakpoint
CREATE INDEX "inventory_loans_person" ON "inventory_loans" USING btree ("organization_id","person_id","returned_on");--> statement-breakpoint
CREATE INDEX "inventory_loans_due" ON "inventory_loans" USING btree ("organization_id","due_on");--> statement-breakpoint
-- Items and loans are retired or returned, never deleted; history stays traceable.
CREATE TRIGGER inventory_items_no_delete BEFORE DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER inventory_loans_no_delete BEFORE DELETE ON inventory_loans FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER inventory_items_versioned BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION bnature_versioned_update();
--> statement-breakpoint
-- Open loans never bind more pieces than exist; the item row lock serializes concurrent lending.
CREATE FUNCTION bnature_inventory_loan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 item inventory_items%ROWTYPE;
 lent integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.item_id<>OLD.item_id OR NEW.person_id<>OLD.person_id
   OR NEW.quantity<>OLD.quantity OR NEW.issued_on<>OLD.issued_on OR NEW.issue_condition<>OLD.issue_condition
   OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Loan identity, quantity and issue data are immutable';
  END IF;
  IF OLD.returned_on IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Returned loans are closed';
  END IF;
 END IF;
 SELECT * INTO item FROM inventory_items WHERE organization_id=NEW.organization_id AND id=NEW.item_id FOR UPDATE;
 IF TG_OP='INSERT' AND item.status<>'active' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retired items cannot be lent';
 END IF;
 IF NEW.returned_on IS NULL THEN
  SELECT coalesce(sum(quantity),0) INTO lent FROM inventory_loans
   WHERE organization_id=NEW.organization_id AND item_id=NEW.item_id AND returned_on IS NULL AND id<>NEW.id;
  IF lent+NEW.quantity>item.quantity THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Not enough pieces available';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER inventory_loans_guard BEFORE INSERT OR UPDATE ON inventory_loans FOR EACH ROW EXECUTE FUNCTION bnature_inventory_loan_guard();
--> statement-breakpoint
CREATE FUNCTION bnature_inventory_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lent integer;
BEGIN
 SELECT coalesce(sum(quantity),0) INTO lent FROM inventory_loans
  WHERE organization_id=NEW.organization_id AND item_id=NEW.id AND returned_on IS NULL;
 IF NEW.quantity<lent THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quantity below pieces currently lent';
 END IF;
 IF NEW.status='retired' AND lent>0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Items with open loans cannot be retired';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER inventory_items_guard BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION bnature_inventory_item_guard();
