CREATE TABLE "work"."access_review_items" (
	"review_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"removal_request_id" uuid,
	CONSTRAINT "access_review_items_review_id_entitlement_id_pk" PRIMARY KEY("review_id","entitlement_id")
);
--> statement-breakpoint
CREATE TABLE "work"."access_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"privilege" text NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "work"."access_review_items" ADD CONSTRAINT "access_review_items_review_id_access_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "work"."access_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_review_items" ADD CONSTRAINT "access_review_items_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "work"."entitlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_review_items" ADD CONSTRAINT "access_review_items_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_review_items" ADD CONSTRAINT "access_review_items_removal_request_id_entitlement_requests_id_fk" FOREIGN KEY ("removal_request_id") REFERENCES "work"."entitlement_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_reviews" ADD CONSTRAINT "access_reviews_system_id_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "work"."access_systems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_reviews" ADD CONSTRAINT "access_reviews_opened_by_members_id_fk" FOREIGN KEY ("opened_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_reviews_system" ON "work"."access_reviews" USING btree ("system_id","privilege","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_reviews_open" ON "work"."access_reviews" USING btree ("system_id","privilege") WHERE closed_at IS NULL;