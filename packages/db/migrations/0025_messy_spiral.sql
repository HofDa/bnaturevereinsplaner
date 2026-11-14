CREATE TABLE "cost_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_plan_name" CHECK (length(trim("cost_plans"."name")) between 1 and 200),
	CONSTRAINT "cost_plan_version" CHECK ("cost_plans"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cost_plans" ADD CONSTRAINT "cost_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_plans" ADD CONSTRAINT "cost_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_plans_org" ON "cost_plans" USING btree ("organization_id","name");