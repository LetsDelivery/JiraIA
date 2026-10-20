CREATE TABLE "work"."automation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"automation_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."automations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."event_receipts" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_receipts_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "work"."forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type_id" uuid NOT NULL,
	"state_id" uuid,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."slack_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."audit_events" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
-- History before the bus existed is not news: mark it sent, or the first dispatch would replay every change ever made (ADR-0014).
UPDATE "work"."audit_events" SET "dispatched_at" = "occurred_at";--> statement-breakpoint
ALTER TABLE "work"."automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "work"."automations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."automations" ADD CONSTRAINT "automations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."automations" ADD CONSTRAINT "automations_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."forms" ADD CONSTRAINT "forms_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."forms" ADD CONSTRAINT "forms_type_id_card_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "work"."card_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."forms" ADD CONSTRAINT "forms_state_id_workflow_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "work"."workflow_states"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_automation" ON "work"."automation_runs" USING btree ("automation_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_once" ON "work"."automation_runs" USING btree ("automation_id","event_id");--> statement-breakpoint
CREATE INDEX "automations_space" ON "work"."automations" USING btree ("space_id","enabled");--> statement-breakpoint
CREATE INDEX "forms_space" ON "work"."forms" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channels_name" ON "work"."slack_channels" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "audit_events_pending" ON "work"."audit_events" USING btree ("occurred_at") WHERE dispatched_at IS NULL;