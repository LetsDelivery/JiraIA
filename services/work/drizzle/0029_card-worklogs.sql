CREATE TABLE "work"."card_worklogs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."card_worklogs" ADD CONSTRAINT "card_worklogs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_worklogs" ADD CONSTRAINT "card_worklogs_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_worklogs_card" ON "work"."card_worklogs" USING btree ("card_id","started_at");