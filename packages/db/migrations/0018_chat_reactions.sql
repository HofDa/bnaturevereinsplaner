CREATE TABLE "community_chat_reactions" (
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_chat_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji"),
	CONSTRAINT "community_chat_reaction_emoji" CHECK ("community_chat_reactions"."emoji" in ('👍', '❤️', '😂', '😮', '🎉', '🙏'))
);
--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_tenant" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "community_chat_reactions" ADD CONSTRAINT "community_chat_reactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_reactions" ADD CONSTRAINT "community_chat_reactions_organization_id_message_id_community_chat_messages_organization_id_id_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."community_chat_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_reactions" ADD CONSTRAINT "community_chat_reactions_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "community_chat_reaction_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "community_chat_messages"
    WHERE "id" = NEW."message_id" AND "organization_id" = NEW."organization_id" AND "removed_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Reactions on removed chat messages are not allowed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "community_chat_reaction_guard" BEFORE INSERT OR UPDATE ON "community_chat_reactions"
  FOR EACH ROW EXECUTE FUNCTION "community_chat_reaction_guard"();
