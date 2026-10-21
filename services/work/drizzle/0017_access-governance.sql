CREATE TABLE "work"."access_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"system_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"privilege" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."access_system_staff" (
	"system_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"duty" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "access_system_staff_system_id_member_id_duty_pk" PRIMARY KEY("system_id","member_id","duty")
);
--> statement-breakpoint
CREATE TABLE "work"."access_systems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"holds_personal_data" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work"."entitlement_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"entitlement_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"evidence" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"grant_request_id" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"removal_request_id" uuid,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "work"."members" ADD COLUMN "is_access_auditor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work"."access_profiles" ADD CONSTRAINT "access_profiles_system_id_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "work"."access_systems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_system_staff" ADD CONSTRAINT "access_system_staff_system_id_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "work"."access_systems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."access_system_staff" ADD CONSTRAINT "access_system_staff_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_system_id_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "work"."access_systems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_profile_id_access_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "work"."access_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_beneficiary_id_members_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_requester_id_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_decided_by_members_id_fk" FOREIGN KEY ("decided_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlement_requests" ADD CONSTRAINT "entitlement_requests_completed_by_members_id_fk" FOREIGN KEY ("completed_by") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlements" ADD CONSTRAINT "entitlements_system_id_access_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "work"."access_systems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlements" ADD CONSTRAINT "entitlements_profile_id_access_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "work"."access_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlements" ADD CONSTRAINT "entitlements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "work"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlements" ADD CONSTRAINT "entitlements_grant_request_id_entitlement_requests_id_fk" FOREIGN KEY ("grant_request_id") REFERENCES "work"."entitlement_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work"."entitlements" ADD CONSTRAINT "entitlements_removal_request_id_entitlement_requests_id_fk" FOREIGN KEY ("removal_request_id") REFERENCES "work"."entitlement_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_profiles_system" ON "work"."access_profiles" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "access_system_staff_member" ON "work"."access_system_staff" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "access_systems_organization" ON "work"."access_systems" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "entitlement_requests_system" ON "work"."entitlement_requests" USING btree ("system_id","status");--> statement-breakpoint
CREATE INDEX "entitlement_requests_beneficiary" ON "work"."entitlement_requests" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_requests_open" ON "work"."entitlement_requests" USING btree ("profile_id","beneficiary_id","kind") WHERE status IN ('requested', 'approved');--> statement-breakpoint
CREATE INDEX "entitlements_member" ON "work"."entitlements" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "entitlements_system" ON "work"."entitlements" USING btree ("system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_held" ON "work"."entitlements" USING btree ("profile_id","member_id") WHERE removed_at IS NULL;