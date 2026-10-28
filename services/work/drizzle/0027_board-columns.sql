CREATE TABLE "work"."board_columns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."workflow_states" ADD COLUMN "column_id" uuid;--> statement-breakpoint
ALTER TABLE "work"."board_columns" ADD CONSTRAINT "board_columns_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "work"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_columns_name_unique" ON "work"."board_columns" USING btree ("space_id","name");--> statement-breakpoint
ALTER TABLE "work"."workflow_states" ADD CONSTRAINT "workflow_states_column_id_board_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "work"."board_columns"("id") ON DELETE no action ON UPDATE no action;