CREATE TABLE "work"."slack_links" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slack_user_id" text,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."slack_workspaces" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"bot_token" text NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."slack_links" ADD CONSTRAINT "slack_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."slack_workspaces" ADD CONSTRAINT "slack_workspaces_installed_by_members_id_fk" FOREIGN KEY ("installed_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;