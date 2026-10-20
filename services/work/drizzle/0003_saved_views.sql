CREATE TABLE "work"."saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"space_id" uuid,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order" jsonb NOT NULL,
	"layout" text NOT NULL,
	"lanes" text DEFAULT 'none' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."saved_views" ADD CONSTRAINT "saved_views_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."saved_views" ADD CONSTRAINT "saved_views_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_space" ON "work"."saved_views" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "saved_views_owner" ON "work"."saved_views" USING btree ("owner_id");