CREATE TABLE "work"."labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."labels" ADD CONSTRAINT "labels_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_name_unique" ON "work"."labels" USING btree ("space_id","name");--> statement-breakpoint
-- Every label the cards already carry, once per space, in the colour `colorOf` gives its name
-- (labels/label.schemas.ts): the first 7 hex digits of its md5, modulo the eight colours.
INSERT INTO "work"."labels" ("id", "space_id", "name", "color", "created_at")
SELECT gen_random_uuid(), "space_id", "name",
  (ARRAY['red','orange','yellow','green','teal','blue','violet','pink'])[1 + (('x' || lpad(substr(md5("name"), 1, 7), 8, '0'))::bit(32)::int % 8)],
  now()
FROM (SELECT DISTINCT c."space_id", l."name" FROM "work"."cards" c CROSS JOIN LATERAL jsonb_array_elements_text(c."labels") AS l("name")) AS used;
