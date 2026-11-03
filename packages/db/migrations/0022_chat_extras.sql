CREATE TABLE "community_chat_mentions" (
	"organization_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "community_chat_mentions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD COLUMN "attachment_kind" text;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "community_chat_mentions" ADD CONSTRAINT "community_chat_mentions_message_fk" FOREIGN KEY ("organization_id","message_id") REFERENCES "public"."community_chat_messages"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_mentions" ADD CONSTRAINT "community_chat_mentions_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."organization_user_roles"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_chat_mentions_user" ON "community_chat_mentions" USING btree ("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_reply_fk" FOREIGN KEY ("organization_id","reply_to_id") REFERENCES "public"."community_chat_messages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_chat_messages" ADD CONSTRAINT "community_chat_attachment" CHECK (("community_chat_messages"."attachment_kind" is null) = ("community_chat_messages"."attachment_id" is null) and ("community_chat_messages"."attachment_kind" is null or "community_chat_messages"."attachment_kind" in ('event','poll')));