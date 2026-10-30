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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "community_votes" (
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_votes_organization_id_post_id_user_id_pk" PRIMARY KEY("organization_id","post_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "community_options" ADD CONSTRAINT "community_options_organization_id_post_id_community_posts_organization_id_id_fk" FOREIGN KEY ("organization_id","post_id") REFERENCES "public"."community_posts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_organization_id_post_id_option_id_community_options_organization_id_post_id_id_fk" FOREIGN KEY ("organization_id","post_id","option_id") REFERENCES "public"."community_options"("organization_id","post_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_posts_feed" ON "community_posts" USING btree ("organization_id","kind","state","published_at");--> statement-breakpoint
CREATE INDEX "community_votes_results" ON "community_votes" USING btree ("organization_id","post_id","option_id");
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER community_post_guard BEFORE INSERT OR UPDATE ON community_posts FOR EACH ROW EXECUTE FUNCTION guard_community_post();
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER community_option_guard BEFORE INSERT OR UPDATE OR DELETE ON community_options FOR EACH ROW EXECUTE FUNCTION guard_community_option();
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER community_vote_guard BEFORE INSERT OR UPDATE OR DELETE ON community_votes FOR EACH ROW EXECUTE FUNCTION guard_community_vote();
