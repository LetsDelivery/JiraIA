CREATE TABLE "work"."content_visits" (
	"member_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"visited_at" timestamp with time zone NOT NULL,
	CONSTRAINT "content_visits_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "work"."content_versions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "work"."content_visits" ADD CONSTRAINT "content_visits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_visits" ADD CONSTRAINT "content_visits_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_visits_recent" ON "work"."content_visits" USING btree ("member_id","visited_at");