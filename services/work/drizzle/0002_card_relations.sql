CREATE TABLE "work"."card_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"object_key" text NOT NULL,
	"status" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."card_key_aliases" (
	"organization_id" uuid NOT NULL,
	"space_key" text NOT NULL,
	"number" integer NOT NULL,
	"card_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_key_aliases_organization_id_space_key_number_pk" PRIMARY KEY("organization_id","space_key","number")
);
--> statement-breakpoint
CREATE TABLE "work"."card_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_card_id" uuid NOT NULL,
	"to_card_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."card_watchers" (
	"card_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_watchers_card_id_member_id_pk" PRIMARY KEY("card_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "work"."comment_reactions" (
	"comment_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_member_id_emoji_pk" PRIMARY KEY("comment_id","member_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "work"."custom_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."card_comments" ADD COLUMN "mentions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD COLUMN "backlog_rank" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."card_attachments" ADD CONSTRAINT "card_attachments_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_attachments" ADD CONSTRAINT "card_attachments_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_key_aliases" ADD CONSTRAINT "card_key_aliases_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_links" ADD CONSTRAINT "card_links_from_card_id_cards_id_fk" FOREIGN KEY ("from_card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_links" ADD CONSTRAINT "card_links_to_card_id_cards_id_fk" FOREIGN KEY ("to_card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_links" ADD CONSTRAINT "card_links_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_watchers" ADD CONSTRAINT "card_watchers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_watchers" ADD CONSTRAINT "card_watchers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_card_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "work"."card_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."comment_reactions" ADD CONSTRAINT "comment_reactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."custom_fields" ADD CONSTRAINT "custom_fields_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_attachments_card" ON "work"."card_attachments" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_links_unique" ON "work"."card_links" USING btree ("type","from_card_id","to_card_id");--> statement-breakpoint
CREATE INDEX "card_links_to" ON "work"."card_links" USING btree ("to_card_id");--> statement-breakpoint
CREATE INDEX "card_watchers_member" ON "work"."card_watchers" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_name_unique" ON "work"."custom_fields" USING btree ("space_id","name");--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_parent_id_cards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_parent" ON "work"."cards" USING btree ("parent_id");--> statement-breakpoint
-- The backlog starts in creation order: each card ranks by its number.
UPDATE "work"."cards" SET "backlog_rank" = "number";