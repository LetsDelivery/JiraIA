CREATE TABLE "work"."proposal_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"card_id" uuid,
	"payload" jsonb NOT NULL,
	"adjusted" jsonb,
	"base" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "work"."proposal_policies" (
	"space_id" uuid PRIMARY KEY NOT NULL,
	"auto_apply" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"on_behalf_of_id" uuid,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"auto_applied" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"reverted_by" uuid,
	"reverted_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."audit_events" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."proposal_items" ADD CONSTRAINT "proposal_items_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "work"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposal_policies" ADD CONSTRAINT "proposal_policies_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposal_policies" ADD CONSTRAINT "proposal_policies_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposals" ADD CONSTRAINT "proposals_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposals" ADD CONSTRAINT "proposals_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposals" ADD CONSTRAINT "proposals_on_behalf_of_id_members_id_fk" FOREIGN KEY ("on_behalf_of_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposals" ADD CONSTRAINT "proposals_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."proposals" ADD CONSTRAINT "proposals_reverted_by_members_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_items_proposal" ON "work"."proposal_items" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposal_items_card" ON "work"."proposal_items" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "proposals_space" ON "work"."proposals" USING btree ("space_id","status","created_at");--> statement-breakpoint
CREATE INDEX "proposals_author" ON "work"."proposals" USING btree ("author_id","created_at");