CREATE TABLE "work"."oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"client_uri" text,
	"agent_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."oauth_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."oauth_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."oauth_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work"."oauth_clients" ADD CONSTRAINT "oauth_clients_agent_id_members_id_fk" FOREIGN KEY ("agent_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "work"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_codes" ADD CONSTRAINT "oauth_codes_person_id_members_id_fk" FOREIGN KEY ("person_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_connections" ADD CONSTRAINT "oauth_connections_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "work"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_connections" ADD CONSTRAINT "oauth_connections_person_id_members_id_fk" FOREIGN KEY ("person_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_connections" ADD CONSTRAINT "oauth_connections_agent_id_members_id_fk" FOREIGN KEY ("agent_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "work"."oauth_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_connections_person" ON "work"."oauth_connections" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_connection" ON "work"."oauth_tokens" USING btree ("connection_id");