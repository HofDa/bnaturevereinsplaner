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
--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_messages_organization_id_created_by_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","created_by") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_chat_channel" ON "community_chat_messages" USING btree ("organization_id","group_id","created_at","id");