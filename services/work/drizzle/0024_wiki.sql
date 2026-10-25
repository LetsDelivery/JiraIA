CREATE TABLE "work"."wiki_collections" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"review_days" integer NOT NULL,
	"outline" text
);
--> statement-breakpoint
CREATE TABLE "work"."wiki_pages" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"state" text NOT NULL,
	"official_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"review_due" timestamp with time zone,
	"source_id" uuid,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "work"."draw_spaces_organization";--> statement-breakpoint
ALTER TABLE "work"."draw_spaces" ADD COLUMN "area" text DEFAULT 'draw' NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."wiki_collections" ADD CONSTRAINT "wiki_collections_space_id_draw_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."draw_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."wiki_pages" ADD CONSTRAINT "wiki_pages_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."wiki_pages" ADD CONSTRAINT "wiki_pages_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."wiki_pages" ADD CONSTRAINT "wiki_pages_source_id_contents_id_fk" FOREIGN KEY ("source_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_pages_owner_due" ON "work"."wiki_pages" USING btree ("owner_id","review_due");--> statement-breakpoint
CREATE INDEX "draw_spaces_organization" ON "work"."draw_spaces" USING btree ("organization_id","area");