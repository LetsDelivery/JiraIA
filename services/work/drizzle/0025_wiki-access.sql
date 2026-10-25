CREATE TABLE "work"."wiki_favorites" (
	"member_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wiki_favorites_member_id_content_id_pk" PRIMARY KEY("member_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "work"."contents" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "work"."wiki_collections" ADD COLUMN "access" text DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."wiki_collections" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."wiki_favorites" ADD CONSTRAINT "wiki_favorites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."wiki_favorites" ADD CONSTRAINT "wiki_favorites_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."wiki_collections" ADD CONSTRAINT "wiki_collections_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_collections_owner" ON "work"."wiki_collections" USING btree ("owner_id");