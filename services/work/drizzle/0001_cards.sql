CREATE TABLE "work"."card_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."card_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"type_id" uuid NOT NULL,
	"state_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_date" date,
	"estimate" text,
	"rank" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."workflow_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."card_comments" ADD CONSTRAINT "card_comments_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "work"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_comments" ADD CONSTRAINT "card_comments_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."card_types" ADD CONSTRAINT "card_types_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_type_id_card_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "work"."card_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_state_id_workflow_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "work"."workflow_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_assignee_id_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_reporter_id_members_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."workflow_states" ADD CONSTRAINT "workflow_states_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_comments_card" ON "work"."card_comments" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "card_types_name_unique" ON "work"."card_types" USING btree ("space_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_number_unique" ON "work"."cards" USING btree ("space_id","number");--> statement-breakpoint
CREATE INDEX "cards_board" ON "work"."cards" USING btree ("space_id","state_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_states_name_unique" ON "work"."workflow_states" USING btree ("space_id","name");