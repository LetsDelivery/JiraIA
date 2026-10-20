CREATE TABLE "work"."content_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"parent_id" uuid,
	"anchor_id" text,
	"quote" text,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "work"."content_connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"can_write" boolean NOT NULL,
	"connected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."content_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"object_key" text NOT NULL,
	"status" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."content_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"update" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."content_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"document" text NOT NULL,
	"reason" text NOT NULL,
	"restored_from" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."contents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"position" double precision NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."draw_space_marks" (
	"space_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"mark" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "draw_space_marks_space_id_member_id_mark_pk" PRIMARY KEY("space_id","member_id","mark")
);
--> statement-breakpoint
CREATE TABLE "work"."draw_spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."realtime_tickets" (
	"token" text PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"can_write" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."content_comments" ADD CONSTRAINT "content_comments_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_comments" ADD CONSTRAINT "content_comments_parent_id_content_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "work"."content_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_comments" ADD CONSTRAINT "content_comments_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_comments" ADD CONSTRAINT "content_comments_resolved_by_members_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_connections" ADD CONSTRAINT "content_connections_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_connections" ADD CONSTRAINT "content_connections_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_files" ADD CONSTRAINT "content_files_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_files" ADD CONSTRAINT "content_files_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_updates" ADD CONSTRAINT "content_updates_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_updates" ADD CONSTRAINT "content_updates_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_versions" ADD CONSTRAINT "content_versions_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."content_versions" ADD CONSTRAINT "content_versions_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."contents" ADD CONSTRAINT "contents_space_id_draw_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."draw_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."contents" ADD CONSTRAINT "contents_parent_id_contents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."contents" ADD CONSTRAINT "contents_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."contents" ADD CONSTRAINT "contents_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_marks" ADD CONSTRAINT "draw_space_marks_space_id_draw_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."draw_spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_space_marks" ADD CONSTRAINT "draw_space_marks_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."draw_spaces" ADD CONSTRAINT "draw_spaces_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."realtime_tickets" ADD CONSTRAINT "realtime_tickets_content_id_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "work"."contents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."realtime_tickets" ADD CONSTRAINT "realtime_tickets_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_comments_content" ON "work"."content_comments" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_connections_content" ON "work"."content_connections" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_files_content" ON "work"."content_files" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_updates_content" ON "work"."content_updates" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_number" ON "work"."content_versions" USING btree ("content_id","number");--> statement-breakpoint
CREATE INDEX "contents_tree" ON "work"."contents" USING btree ("space_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "draw_spaces_organization" ON "work"."draw_spaces" USING btree ("organization_id");