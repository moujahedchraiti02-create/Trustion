-- 0000_initial_schema.sql
-- Baseline schema for S³V TRUSTION (pre-Task-14 state).
-- Uses CREATE TABLE IF NOT EXISTS so it is safe to run against both
-- fresh and pre-existing databases.  Foreign-key constraints are added
-- inside DO blocks that silently skip if the constraint already exists.
--
-- For databases that already have this baseline schema, apply ONLY the
-- additive migration: 0001_add_key_expiry_and_nullable_alerts.sql

CREATE TABLE IF NOT EXISTS "vessels" (
	"id" serial PRIMARY KEY NOT NULL,
	"imo_number" text NOT NULL,
	"name" text NOT NULL,
	"flag" text NOT NULL,
	"vessel_type" text NOT NULL,
	"gross_tonnage" real NOT NULL,
	"reporting_year" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vessels_imo_number_unique" UNIQUE("imo_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "regulatory_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"effective_date" date NOT NULL,
	"co2_factor" real NOT NULL,
	"ch4_gwp" real NOT NULL,
	"n2o_gwp" real NOT NULL,
	"methane_slip_default" real NOT NULL,
	"max_data_gap_pct" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"vessel_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"timestamp_gnss" timestamp with time zone NOT NULL,
	"timestamp_device" timestamp with time zone,
	"timestamp_server" timestamp with time zone DEFAULT now() NOT NULL,
	"temporal_trust" text DEFAULT 'TRUSTED_GNSS' NOT NULL,
	"fuel_type" text NOT NULL,
	"fuel_mass_kg" real NOT NULL,
	"engine_load_pct" real NOT NULL,
	"position_lat" real,
	"position_lon" real,
	"raw_hash" text NOT NULL,
	"prev_hash" text,
	"chain_hash" text NOT NULL,
	"signature" text,
	"public_key" text,
	"key_id" text,
	"signer_mode" text DEFAULT 'SOFTWARE_ED25519' NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emissions_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"vessel_id" integer NOT NULL,
	"ledger_entry_id" integer NOT NULL,
	"scope" text NOT NULL,
	"co2_kg" real NOT NULL,
	"ch4_kg" real NOT NULL,
	"n2o_kg" real NOT NULL,
	"co2e_kg" real NOT NULL,
	"wtw_factor" real NOT NULL,
	"ttw_factor" real NOT NULL,
	"methane_slip_method" text DEFAULT 'REGULATORY_DEFAULT' NOT NULL,
	"regulatory_profile_id" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- alerts: vessel_id, threshold_pct, and current_pct are NOT NULL in the baseline.
-- They are made nullable by 0001_add_key_expiry_and_nullable_alerts.sql.
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"vessel_id" integer NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"threshold_pct" real NOT NULL,
	"current_pct" real NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auditor_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"vessel_id" integer NOT NULL,
	"evidence_package_hash" text NOT NULL,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"verifier_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- signing_key_registry: expires_at is absent in the baseline.
-- It is added by 0001_add_key_expiry_and_nullable_alerts.sql.
CREATE TABLE IF NOT EXISTS "signing_key_registry" (
	"key_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"algorithm" text DEFAULT 'Ed25519' NOT NULL,
	"signing_mode" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_key_registry_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signing_key_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_id" text NOT NULL,
	"event_type" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Foreign key constraints (silently skipped if they already exist)
DO $$ BEGIN
  ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_vessel_id_vessels_id_fk"
    FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emissions_records" ADD CONSTRAINT "emissions_records_vessel_id_vessels_id_fk"
    FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emissions_records" ADD CONSTRAINT "emissions_records_ledger_entry_id_ledger_entries_id_fk"
    FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emissions_records" ADD CONSTRAINT "emissions_records_regulatory_profile_id_regulatory_profiles_id_fk"
    FOREIGN KEY ("regulatory_profile_id") REFERENCES "public"."regulatory_profiles"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "alerts" ADD CONSTRAINT "alerts_vessel_id_vessels_id_fk"
    FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "auditor_decisions" ADD CONSTRAINT "auditor_decisions_vessel_id_vessels_id_fk"
    FOREIGN KEY ("vessel_id") REFERENCES "public"."vessels"("id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signing_key_events" ADD CONSTRAINT "signing_key_events_key_id_signing_key_registry_key_id_fk"
    FOREIGN KEY ("key_id") REFERENCES "public"."signing_key_registry"("key_id")
    ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
