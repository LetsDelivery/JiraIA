CREATE TABLE "work"."notification_preferences" (
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_preferences_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
CREATE TABLE "work"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"card_id" uuid,
	"space_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"emailed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "work"."notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."notifications" ADD CONSTRAINT "notifications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."notifications" ADD CONSTRAINT "notifications_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_once" ON "work"."notifications" USING btree ("member_id","event_id");--> statement-breakpoint
CREATE INDEX "notifications_inbox" ON "work"."notifications" USING btree ("member_id","archived_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_digest" ON "work"."notifications" USING btree ("emailed_at") WHERE emailed_at IS NULL AND read_at IS NULL;