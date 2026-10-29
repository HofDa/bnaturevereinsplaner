CREATE TYPE "public"."document_category" AS ENUM('receipt', 'contract', 'minutes', 'statute', 'correspondence', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_media_type" AS ENUM('application/pdf', 'image/png', 'image/jpeg');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"filename" text NOT NULL,
	"media_type" "document_media_type" NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_versions_number_unique" UNIQUE("organization_id","document_id","version_number"),
	CONSTRAINT "document_version_number_valid" CHECK ("document_versions"."version_number">0),
	CONSTRAINT "document_size_valid" CHECK ("document_versions"."size_bytes" between 1 and 10485760),
	CONSTRAINT "document_sha256_valid" CHECK ("document_versions"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_filename_valid" CHECK (length("document_versions"."filename") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" "document_category" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"cashbook_entry_id" uuid,
	"membership_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "document_title_valid" CHECK (length(trim("documents"."title")) between 1 and 200),
	CONSTRAINT "document_version_valid" CHECK ("documents"."version">0)
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_document_id_documents_organization_id_id_fk" FOREIGN KEY ("organization_id","document_id") REFERENCES "public"."documents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_cashbook_entry_id_cashbook_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","cashbook_entry_id") REFERENCES "public"."cashbook_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_org_archived_idx" ON "documents" USING btree ("organization_id","archived","created_at");--> statement-breakpoint
CREATE INDEX "documents_cashbook_idx" ON "documents" USING btree ("organization_id","cashbook_entry_id");--> statement-breakpoint
CREATE INDEX "documents_membership_idx" ON "documents" USING btree ("organization_id","membership_id");--> statement-breakpoint
-- Handwritten document invariants: versions are immutable and numbered; documents are archived, never deleted.
CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON document_versions FOR EACH ROW EXECUTE FUNCTION bnature_finance_immutable();
--> statement-breakpoint
CREATE FUNCTION bnature_document_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Documents are archived, not deleted';
  END IF;
  IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid document version or identity';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_update_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION bnature_document_update();
--> statement-breakpoint
CREATE FUNCTION bnature_document_version_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest integer;
BEGIN
  PERFORM 1 FROM documents WHERE organization_id=NEW.organization_id AND id=NEW.document_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='Unknown document'; END IF;
  SELECT max(version_number) INTO latest FROM document_versions WHERE organization_id=NEW.organization_id AND document_id=NEW.document_id;
  IF NEW.version_number<>COALESCE(latest,0)+1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Document versions are sequential';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_version_insert_guard BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION bnature_document_version_insert();
