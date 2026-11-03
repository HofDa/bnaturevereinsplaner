CREATE TABLE "community_notification_settings" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"digest" text DEFAULT 'off' NOT NULL,
	"last_digest_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_digest_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_notification_settings_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "community_digest_mode" CHECK ("community_notification_settings"."digest" in ('off','daily','weekly'))
);
--> statement-breakpoint
CREATE TABLE "community_read_markers" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"group_id" uuid,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_read_markers_scope" UNIQUE NULLS NOT DISTINCT("organization_id","user_id","channel","group_id"),
	CONSTRAINT "community_read_channel" CHECK ("community_read_markers"."channel" in ('news','poll','chat')),
	CONSTRAINT "community_read_group" CHECK ("community_read_markers"."channel"='chat' or "community_read_markers"."group_id" is null)
);
--> statement-breakpoint
ALTER TABLE "mail_messages" DROP CONSTRAINT "mail_message_kind";--> statement-breakpoint
ALTER TABLE "community_notification_settings" ADD CONSTRAINT "community_notification_settings_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_read_markers" ADD CONSTRAINT "community_read_markers_organization_id_user_id_organization_user_roles_organization_id_user_id_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_read_markers" ADD CONSTRAINT "community_read_markers_organization_id_group_id_groups_organization_id_id_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."groups"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_message_kind" CHECK ("mail_messages"."kind" in ('fee_reminder','event_invitation','deadline_reminder','newsletter','account_invitation','password_reset','test','community_digest'));