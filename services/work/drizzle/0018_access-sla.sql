CREATE TABLE "work"."business_holidays" (
	"organization_id" uuid NOT NULL,
	"day" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "business_holidays_organization_id_day_pk" PRIMARY KEY("organization_id","day")
);
--> statement-breakpoint
ALTER TABLE "work"."access_systems" ADD COLUMN "grant_sla_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."access_systems" ADD COLUMN "removal_sla_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."access_systems" ADD COLUMN "departure_sla_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD COLUMN "origin" text DEFAULT 'request' NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD COLUMN "overdue_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "entitlement_requests_due" ON "work"."entitlement_requests" USING btree ("due_at") WHERE status = 'approved' AND overdue_at IS NULL;