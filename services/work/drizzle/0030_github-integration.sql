CREATE TABLE "work"."card_dev_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"repo" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"review" text,
	"checks" text,
	"author" text DEFAULT '' NOT NULL,
	"head_sha" text,
	"merged_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."github_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."github_installations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
ALTER TABLE "work"."spaces" ADD COLUMN "merged_state_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."card_dev_links" ADD CONSTRAINT "card_dev_links_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."github_installations" ADD CONSTRAINT "github_installations_installed_by_members_id_fk" FOREIGN KEY ("installed_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_dev_links_unique" ON "work"."card_dev_links" USING btree ("card_id","repo","kind","ref");--> statement-breakpoint
CREATE INDEX "card_dev_links_ref" ON "work"."card_dev_links" USING btree ("organization_id","repo","kind","ref");--> statement-breakpoint
CREATE INDEX "card_dev_links_sha" ON "work"."card_dev_links" USING btree ("organization_id","repo","head_sha");