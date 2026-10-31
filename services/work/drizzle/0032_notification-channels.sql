ALTER TABLE "work"."notification_preferences" ADD COLUMN "channels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "work"."notification_preferences" SET "channels" = CASE "channel"
  WHEN 'in_app' THEN '["in_app"]'::jsonb
  WHEN 'email' THEN (CASE WHEN "kind" = 'weekly_summary' THEN '["email"]' ELSE '["in_app","email"]' END)::jsonb
  WHEN 'slack' THEN '["in_app","slack"]'::jsonb
  WHEN 'none' THEN '[]'::jsonb
  ELSE (CASE WHEN "kind" = 'weekly_summary' THEN '["email"]' ELSE '["in_app","email"]' END)::jsonb
END;
