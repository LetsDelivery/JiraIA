CREATE TABLE "work"."sprints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"state" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"late_notice_at" timestamp with time zone,
	"committed_cards" integer,
	"committed_points" double precision,
	"completed_cards" integer,
	"completed_points" double precision,
	"carried_cards" integer,
	"carried_points" double precision,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."cards" ADD COLUMN "points" double precision;--> statement-breakpoint
ALTER TABLE "work"."cards" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."spaces" ADD COLUMN "uses_sprints" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."spaces" ADD COLUMN "estimation" text DEFAULT 'tshirt' NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."sprints" ADD CONSTRAINT "sprints_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_number_unique" ON "work"."sprints" USING btree ("space_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_active" ON "work"."sprints" USING btree ("space_id") WHERE state = 'active';--> statement-breakpoint
ALTER TABLE "work"."cards" ADD CONSTRAINT "cards_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "work"."sprints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cards_sprint" ON "work"."cards" USING btree ("sprint_id");--> statement-breakpoint
-- Software spaces plan in sprints from the start (ADR-0029); an admin switches it off.
UPDATE "work"."spaces" SET "uses_sprints" = true WHERE "type" = 'software';
