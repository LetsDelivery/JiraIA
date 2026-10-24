CREATE TABLE "work"."card_stars" (
	"member_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_stars_member_id_card_id_pk" PRIMARY KEY("member_id","card_id")
);
--> statement-breakpoint
ALTER TABLE "work"."card_stars" ADD CONSTRAINT "card_stars_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_stars" ADD CONSTRAINT "card_stars_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;