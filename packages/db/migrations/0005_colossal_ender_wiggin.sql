CREATE TABLE "payment_booking_defaults" (
	"organization_id" uuid NOT NULL,
	"method" text NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "payment_booking_defaults_organization_id_method_pk" PRIMARY KEY("organization_id","method"),
	CONSTRAINT "payment_booking_default_method_valid" CHECK ("payment_booking_defaults"."method" in ('cash','bank_transfer','other'))
);
--> statement-breakpoint
ALTER TABLE "payment_booking_defaults" ADD CONSTRAINT "payment_booking_defaults_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_booking_defaults" ADD CONSTRAINT "payment_booking_defaults_organization_id_account_id_finance_accounts_organization_id_id_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."finance_accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_booking_defaults" ADD CONSTRAINT "payment_booking_defaults_organization_id_category_id_cashbook_categories_organization_id_id_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."cashbook_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;