CREATE TABLE "work"."import_refs" (
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"entity" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"run_id" text NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "import_refs_organization_id_source_entity_source_id_pk" PRIMARY KEY("organization_id","source","entity","source_id")
);
