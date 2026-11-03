-- Reconcile databases migrated on either pre-merge branch.
-- Legacy timestamps and SQL contents stay intact; existing module data is preserved.
--> statement-breakpoint
DO $merge_inventory_items_0017$
BEGIN
  IF to_regclass('public.inventory_items') IS NULL THEN
CREATE TYPE "public"."inventory_condition" AS ENUM('new', 'good', 'worn', 'damaged', 'defective');
CREATE TYPE "public"."inventory_item_status" AS ENUM('active', 'retired');
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

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_item_id_inventory_items_organization_id_id_fk" FOREIGN KEY ("organization_id","item_id") REFERENCES "public"."inventory_items"("organization_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_organization_id_person_id_persons_organization_id_id_fk" FOREIGN KEY ("organization_id","person_id") REFERENCES "public"."persons"("organization_id","id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "inventory_items_number" ON "inventory_items" USING btree ("organization_id","inventory_number") WHERE "inventory_items"."inventory_number" <> '';
CREATE INDEX "inventory_items_org_name" ON "inventory_items" USING btree ("organization_id","status","name");
CREATE INDEX "inventory_loans_item" ON "inventory_loans" USING btree ("organization_id","item_id","returned_on");
CREATE INDEX "inventory_loans_person" ON "inventory_loans" USING btree ("organization_id","person_id","returned_on");
CREATE INDEX "inventory_loans_due" ON "inventory_loans" USING btree ("organization_id","due_on");
-- Items and loans are retired or returned, never deleted; history stays traceable.
CREATE TRIGGER inventory_items_no_delete BEFORE DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER inventory_loans_no_delete BEFORE DELETE ON inventory_loans FOR EACH ROW EXECUTE FUNCTION bnature_no_delete();
CREATE TRIGGER inventory_items_versioned BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION bnature_versioned_update();

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

  END IF;
END $merge_inventory_items_0017$;
--> statement-breakpoint
DO $merge_mail_newsletters_0017$
BEGIN
  IF to_regclass('public.mail_newsletters') IS NULL THEN
CREATE TABLE "mail_newsletters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_i18n" jsonb NOT NULL,
	"body_i18n" jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_newsletters_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "mail_newsletter_status" CHECK ("mail_newsletters"."status" in ('draft','sent','withdrawn')),
	CONSTRAINT "mail_newsletter_sent" CHECK (("mail_newsletters"."status"='sent')=("mail_newsletters"."sent_at" is not null))
);

ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_message_kind";
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_message_source";
ALTER TABLE "mail_messages" ALTER COLUMN "person_id" DROP NOT NULL;
ALTER TABLE "persons" ADD COLUMN "newsletter_opt_out" boolean DEFAULT false NOT NULL;
ALTER TABLE "mail_messages" ADD COLUMN "user_id" uuid;
ALTER TABLE "mail_messages" ADD COLUMN "deadline_id" uuid;
ALTER TABLE "mail_messages" ADD COLUMN "newsletter_id" uuid;
ALTER TABLE "mail_messages" ADD COLUMN "secret_ciphertext" text;
ALTER TABLE "mail_messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "mail_messages" ADD COLUMN "resolved_by" uuid;
ALTER TABLE "mail_messages" ADD COLUMN "resolved_at" timestamp with time zone;
ALTER TABLE "mail_messages" ADD COLUMN "resolution" text;
ALTER TABLE "mail_messages" ADD COLUMN "resolution_note" text DEFAULT '' NOT NULL;
ALTER TABLE "mail_settings" ADD COLUMN "automatic_deadline_reminders" boolean DEFAULT false NOT NULL;
ALTER TABLE "mail_settings" ADD COLUMN "deadline_last_run_on" date;
ALTER TABLE "mail_newsletters" ADD CONSTRAINT "mail_newsletters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mail_newsletters" ADD CONSTRAINT "mail_newsletters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "mail_newsletters_org_idx" ON "mail_newsletters" USING btree ("organization_id","created_at");
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_deadline_id_compliance_deadlines_organization_id_id_fk" FOREIGN KEY ("organization_id","deadline_id") REFERENCES "public"."compliance_deadlines"("organization_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_newsletter_id_mail_newsletters_organization_id_id_fk" FOREIGN KEY ("organization_id","newsletter_id") REFERENCES "public"."mail_newsletters"("organization_id","id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "mail_messages_user_idx" ON "mail_messages" USING btree ("user_id","kind","created_at");
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_secret" CHECK ("mail_messages"."secret_ciphertext" is null or "mail_messages"."kind" in ('account_invitation','password_reset'));
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_resolution" CHECK (("mail_messages"."resolution" is null) = ("mail_messages"."resolved_at" is null and "mail_messages"."resolved_by" is null) and ("mail_messages"."resolution" is null or "mail_messages"."resolution" in ('retry','mark_sent','dismiss')));
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_kind" CHECK ("mail_messages"."kind" in ('fee_reminder','event_invitation','deadline_reminder','newsletter','account_invitation','password_reset','test'));
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_source" CHECK (case "mail_messages"."kind"
        when 'fee_reminder' then "mail_messages"."person_id" is not null and "mail_messages"."assessment_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."event_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
        when 'event_invitation' then "mail_messages"."person_id" is not null and "mail_messages"."event_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."assessment_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
        when 'deadline_reminder' then "mail_messages"."user_id" is not null and "mail_messages"."deadline_id" is not null and num_nonnulls("mail_messages"."person_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."newsletter_id") = 0
        when 'newsletter' then "mail_messages"."person_id" is not null and "mail_messages"."newsletter_id" is not null and num_nonnulls("mail_messages"."user_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."deadline_id") = 0
        else "mail_messages"."user_id" is not null and num_nonnulls("mail_messages"."person_id", "mail_messages"."assessment_id", "mail_messages"."event_id", "mail_messages"."deadline_id", "mail_messages"."newsletter_id") = 0
      end);
  END IF;
END $merge_mail_newsletters_0017$;
--> statement-breakpoint
DO $merge_community_posts_0017$
BEGIN
  IF to_regclass('public.community_posts') IS NULL THEN
CREATE TABLE "community_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"label_i18n" jsonb NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "community_options_org_post_id" UNIQUE("organization_id","post_id","id"),
	CONSTRAINT "community_options_position" UNIQUE("post_id","position"),
	CONSTRAINT "community_option_position" CHECK ("community_options"."position" between 0 and 9),
	CONSTRAINT "community_option_labels" CHECK (length(trim("community_options"."label_i18n"->>'de'))>0 and length(trim("community_options"."label_i18n"->>'it'))>0)
);

CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title_i18n" jsonb NOT NULL,
	"body_i18n" jsonb NOT NULL,
	"group_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"results_visibility" text DEFAULT 'after_vote' NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "community_posts_org_id" UNIQUE("organization_id","id"),
	CONSTRAINT "community_post_kind" CHECK ("community_posts"."kind" in ('news','poll')),
	CONSTRAINT "community_post_state" CHECK ("community_posts"."state" in ('draft','published','archived')),
	CONSTRAINT "community_results_visibility" CHECK ("community_posts"."results_visibility" in ('after_vote','after_close')),
	CONSTRAINT "community_post_version" CHECK ("community_posts"."version">0),
	CONSTRAINT "community_post_published" CHECK ("community_posts"."state"<>'published' or "community_posts"."published_at" is not null),
	CONSTRAINT "community_post_titles" CHECK (length(trim("community_posts"."title_i18n"->>'de'))>0 and length(trim("community_posts"."title_i18n"->>'it'))>0),
	CONSTRAINT "community_news_body" CHECK ("community_posts"."kind"<>'news' or (length(trim("community_posts"."body_i18n"->>'de'))>0 and length(trim("community_posts"."body_i18n"->>'it'))>0)),
	CONSTRAINT "community_news_no_deadline" CHECK ("community_posts"."kind"='poll' or ("community_posts"."closes_at" is null and "community_posts"."closed_at" is null))
);

CREATE TABLE "community_votes" (
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_votes_organization_id_post_id_user_id_pk" PRIMARY KEY("organization_id","post_id","user_id")
);

ALTER TABLE "community_options" ADD CONSTRAINT "community_options_organization_id_post_id_community_posts_organization_id_id_fk" FOREIGN KEY ("organization_id","post_id") REFERENCES "public"."community_posts"("organization_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_organization_id_post_id_option_id_community_options_organization_id_post_id_id_fk" FOREIGN KEY ("organization_id","post_id","option_id") REFERENCES "public"."community_options"("organization_id","post_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "community_posts_feed" ON "community_posts" USING btree ("organization_id","kind","state","published_at");
CREATE INDEX "community_votes_results" ON "community_votes" USING btree ("organization_id","post_id","option_id");

CREATE FUNCTION guard_community_post() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'draft' OR NEW.version<>1 OR NEW.published_at IS NOT NULL OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Community posts start as drafts' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.organization_id,NEW.kind,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.kind,OLD.created_by,OLD.created_at)
    OR NEW.version<>OLD.version+1 OR OLD.state='archived'
    OR (OLD.state='published' AND NEW.state NOT IN ('published','archived')) THEN
    RAISE EXCEPTION 'Invalid community post transition' USING ERRCODE='23514';
  END IF;
  IF OLD.state='published' AND (NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'Published audience is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state='published' AND OLD.kind='poll' AND
    (NEW.title_i18n IS DISTINCT FROM OLD.title_i18n OR NEW.body_i18n IS DISTINCT FROM OLD.body_i18n OR NEW.closes_at IS DISTINCT FROM OLD.closes_at OR NEW.results_visibility IS DISTINCT FROM OLD.results_visibility) THEN
    RAISE EXCEPTION 'Published poll content is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'A closed poll cannot reopen' USING ERRCODE='23514';
  END IF;
  IF OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL AND (OLD.state<>'published' OR NEW.state<>'published' OR NEW.kind<>'poll') THEN
    RAISE EXCEPTION 'Only published polls can close' USING ERRCODE='23514';
  END IF;
  IF OLD.state='draft' AND NEW.state='published' THEN
    IF NEW.kind='poll' AND ((SELECT count(*) FROM community_options WHERE organization_id=NEW.organization_id AND post_id=NEW.id) NOT BETWEEN 2 AND 10
      OR (NEW.closes_at IS NOT NULL AND NEW.closes_at<=clock_timestamp())) THEN
      RAISE EXCEPTION 'Poll needs valid choices and deadline' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER community_post_guard BEFORE INSERT OR UPDATE ON community_posts FOR EACH ROW EXECUTE FUNCTION guard_community_post();

CREATE FUNCTION guard_community_option() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent community_posts;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id,NEW.organization_id,NEW.post_id) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.post_id) THEN
    RAISE EXCEPTION 'Cannot move poll options' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    SELECT * INTO parent FROM community_posts WHERE organization_id=OLD.organization_id AND id=OLD.post_id FOR UPDATE;
  ELSE
    SELECT * INTO parent FROM community_posts WHERE organization_id=NEW.organization_id AND id=NEW.post_id FOR UPDATE;
  END IF;
  IF parent.id IS NULL OR parent.state<>'draft' OR parent.kind<>'poll' THEN
    RAISE EXCEPTION 'Only draft poll options can change' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER community_option_guard BEFORE INSERT OR UPDATE OR DELETE ON community_options FOR EACH ROW EXECUTE FUNCTION guard_community_option();

CREATE FUNCTION guard_community_vote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent community_posts; voter_role text; active_group boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Votes cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.organization_id,NEW.post_id,NEW.user_id) IS DISTINCT FROM (OLD.organization_id,OLD.post_id,OLD.user_id) THEN
    RAISE EXCEPTION 'Cannot move votes' USING ERRCODE='23514';
  END IF;
  SELECT * INTO parent FROM community_posts WHERE organization_id=NEW.organization_id AND id=NEW.post_id FOR UPDATE;
  IF parent.id IS NULL OR parent.kind<>'poll' OR parent.state<>'published' OR parent.closed_at IS NOT NULL
    OR (parent.closes_at IS NOT NULL AND parent.closes_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'Poll is not open' USING ERRCODE='23514';
  END IF;
  SELECT role INTO voter_role FROM organization_user_roles WHERE organization_id=NEW.organization_id AND user_id=NEW.user_id;
  IF voter_role IS NULL THEN RAISE EXCEPTION 'Voter lacks organization access' USING ERRCODE='23514'; END IF;
  IF parent.group_id IS NOT NULL THEN
    SELECT active INTO active_group FROM groups WHERE organization_id=NEW.organization_id AND id=parent.group_id FOR SHARE;
    IF active_group IS DISTINCT FROM true OR (voter_role NOT IN ('admin','board') AND NOT EXISTS (
      SELECT 1 FROM group_members gm JOIN person_user_links pl ON pl.organization_id=gm.organization_id AND pl.person_id=gm.person_id
      WHERE gm.organization_id=NEW.organization_id AND gm.group_id=parent.group_id AND pl.user_id=NEW.user_id
    )) THEN RAISE EXCEPTION 'Voter lacks group access' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER community_vote_guard BEFORE INSERT OR UPDATE OR DELETE ON community_votes FOR EACH ROW EXECUTE FUNCTION guard_community_vote();

  END IF;
END $merge_community_posts_0017$;
--> statement-breakpoint
DO $merge_community_chat_messages_0017$
BEGIN
  IF to_regclass('public.community_chat_messages') IS NULL THEN
CREATE TABLE "community_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid,
	"created_by" uuid NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "community_chat_body" CHECK (("community_chat_messages"."removed_at" is null and "community_chat_messages"."removed_by" is null and length(trim("community_chat_messages"."body")) between 1 and 2000) or ("community_chat_messages"."removed_at" is not null and "community_chat_messages"."removed_by" is not null and "community_chat_messages"."body"='')),
	CONSTRAINT "community_chat_version" CHECK ("community_chat_messages"."version">0)
);

ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_created_by_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "community_chat_channel" ON "community_chat_messages" USING btree ("organization_id","group_id","created_at","id");
  END IF;
END $merge_community_chat_messages_0017$;
