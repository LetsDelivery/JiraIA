CREATE SCHEMA "work";
--> statement-breakpoint
CREATE TABLE "work"."audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid,
	"actor_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text,
	"email" text,
	"name" text NOT NULL,
	"is_org_admin" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "members_subject_unique" UNIQUE("subject")
);
--> statement-breakpoint
CREATE TABLE "work"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."space_members" (
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_members_space_id_member_id_pk" PRIMARY KEY("space_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "work"."space_stars" (
	"member_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_stars_member_id_space_id_pk" PRIMARY KEY("member_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "work"."space_visits" (
	"member_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_visited_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_visits_member_id_space_id_day_pk" PRIMARY KEY("member_id","space_id","day")
);
--> statement-breakpoint
CREATE TABLE "work"."spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"lead_id" uuid,
	"next_card_number" integer DEFAULT 1 NOT NULL,
	"last_card_activity_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "work"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_members" ADD CONSTRAINT "space_members_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_members" ADD CONSTRAINT "space_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_stars" ADD CONSTRAINT "space_stars_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_stars" ADD CONSTRAINT "space_stars_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_visits" ADD CONSTRAINT "space_visits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_visits" ADD CONSTRAINT "space_visits_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."spaces" ADD CONSTRAINT "spaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "work"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."spaces" ADD CONSTRAINT "spaces_lead_id_members_id_fk" FOREIGN KEY ("lead_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity" ON "work"."audit_events" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_space" ON "work"."audit_events" USING btree ("space_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_unique" ON "work"."members" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "space_members_member" ON "work"."space_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "space_visits_member_recent" ON "work"."space_visits" USING btree ("member_id","last_visited_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_key_unique" ON "work"."spaces" USING btree ("organization_id","key");