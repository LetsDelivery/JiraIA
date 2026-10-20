CREATE TABLE "work"."space_dashboards" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."space_dashboards" ADD CONSTRAINT "space_dashboards_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_dashboards" ADD CONSTRAINT "space_dashboards_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;