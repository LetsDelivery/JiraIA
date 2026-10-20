ALTER TABLE "work"."oauth_clients" DROP CONSTRAINT "oauth_clients_agent_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "work"."oauth_connections" DROP CONSTRAINT "oauth_connections_agent_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "work"."proposals" DROP CONSTRAINT "proposals_on_behalf_of_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "work"."audit_events" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "work"."oauth_clients" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "work"."oauth_connections" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "work"."proposals" DROP COLUMN "on_behalf_of_id";