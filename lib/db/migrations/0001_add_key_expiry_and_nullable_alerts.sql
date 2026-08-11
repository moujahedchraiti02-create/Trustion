-- 0001_add_key_expiry_and_nullable_alerts.sql
-- Additive migration: safe to apply against any database that has the
-- baseline schema (0000_initial_schema.sql).  All statements are
-- idempotent — they use ADD COLUMN IF NOT EXISTS and DROP NOT NULL is
-- safe to repeat (Postgres silently ignores it if the column is already
-- nullable).
--
-- Changes
-- ───────
-- 1. signing_key_registry.expires_at (nullable timestamp)
--    Enables the pre-expiry alert scheduler: when SIGNING_KEY_EXPIRES_AT
--    is set at startup, the server records the deadline here and emits a
--    HIGH-severity KEY_EXPIRY_WARNING alert within the warning window.
--
-- 2. alerts.vessel_id    → nullable
--    alerts.threshold_pct → nullable
--    alerts.current_pct  → nullable
--    System-level alerts (e.g. KEY_LIFECYCLE, KEY_EXPIRY_WARNING) have no
--    associated vessel.  These columns are not meaningful for signing-key
--    lifecycle events, so they must accept NULL.

ALTER TABLE "signing_key_registry"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "vessel_id"     DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "threshold_pct" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "current_pct"   DROP NOT NULL;
