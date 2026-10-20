CREATE TABLE "work"."access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product" text NOT NULL,
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."draw_space_group_roles" (
	"space_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "draw_space_group_roles_space_id_group_id_pk" PRIMARY KEY("space_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "work"."draw_space_members" (
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "draw_space_members_space_id_member_id_pk" PRIMARY KEY("space_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "work"."group_members" (
	"group_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "group_members_group_id_member_id_pk" PRIMARY KEY("group_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "work"."groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."space_group_roles" (
	"space_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_group_roles_space_id_group_id_pk" PRIMARY KEY("space_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "work"."members" ADD COLUMN "is_space_manager" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."access_requests" ADD CONSTRAINT "access_requests_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_requests" ADD CONSTRAINT "access_requests_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_group_roles" ADD CONSTRAINT "draw_space_group_roles_space_id_draw_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."draw_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_group_roles" ADD CONSTRAINT "draw_space_group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "work"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_members" ADD CONSTRAINT "draw_space_members_space_id_draw_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."draw_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_members" ADD CONSTRAINT "draw_space_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "work"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."group_members" ADD CONSTRAINT "group_members_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_group_roles" ADD CONSTRAINT "space_group_roles_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."space_group_roles" ADD CONSTRAINT "space_group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "work"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_space" ON "work"."access_requests" USING btree ("product","space_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_open" ON "work"."access_requests" USING btree ("product","space_id","member_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "draw_space_members_member" ON "work"."draw_space_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "group_members_member" ON "work"."group_members" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "groups_organization" ON "work"."groups" USING btree ("organization_id");--> statement-breakpoint
-- Whoever created a Let’s Draw AI space before ADR-0012 becomes its admin, as new spaces do.
INSERT INTO "work"."draw_space_members" ("space_id", "member_id", "role", "created_at") SELECT "id", "created_by", 'admin', "created_at" FROM "work"."draw_spaces" ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- ADR-0012: the guest role is gone; whoever held it reads, as everyone at Let’s does.
DELETE FROM "work"."space_members" WHERE "role" = 'guest';