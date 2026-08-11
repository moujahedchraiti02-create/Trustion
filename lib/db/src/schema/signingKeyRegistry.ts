import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tamper-evident signing key identity registry.
 *
 * Design rules
 * ────────────
 * • Rows are NEVER deleted.  A key's full identity record is permanent.
 * • Private key material is NEVER stored here.
 * • Status transitions are represented both here (current state for fast
 *   lookup) AND in the append-only signing_key_events table (full audit
 *   trail).  Never rely solely on this status field for forensic history —
 *   always join with signing_key_events.
 * • At most ONE row may have status = 'ACTIVE' at any time.  This is
 *   enforced at the database level with a partial unique index:
 *     CREATE UNIQUE INDEX IF NOT EXISTS one_active_signing_key_idx
 *       ON signing_key_registry ((1)) WHERE status = 'ACTIVE';
 *   applied idempotently at every server startup.
 *
 * Timestamp semantics
 * ───────────────────
 * activated_at  — when the key became ACTIVE for signing (last activation).
 * retired_at    — when the key was retired (stopped signing; history valid).
 * revoked_at    — when the key was declared compromised. Distinct from
 *                 retired_at. A signature whose timestamp_gnss >= revoked_at
 *                 is suspicious and should be flagged by auditors.
 *                 If a key is directly revoked while ACTIVE (never retired),
 *                 both retired_at and revoked_at are set to the revocation
 *                 timestamp.
 */
export const signingKeyRegistryTable = pgTable("signing_key_registry", {
  keyId:            text("key_id").primaryKey(),
  publicKey:        text("public_key").notNull().unique(),
  fingerprint:      text("fingerprint").notNull(),
  algorithm:        text("algorithm").notNull().default("Ed25519"),
  signingMode:      text("signing_mode").notNull(),
  status:           text("status", { enum: ["ACTIVE", "RETIRED", "REVOKED"] }).notNull().default("ACTIVE"),
  activatedAt:      timestamp("activated_at", { withTimezone: true }).notNull(),
  retiredAt:        timestamp("retired_at", { withTimezone: true }),
  revokedAt:        timestamp("revoked_at", { withTimezone: true }),
  revocationReason: text("revocation_reason"),
  /**
   * Optional expiry deadline for this signing key.  When set, the pre-expiry
   * scheduler (checkAndAlertKeyExpiry) emits a HIGH-severity alert within the
   * configured warning window before this timestamp.  Null = no scheduled expiry.
   */
  expiresAt:        timestamp("expires_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SigningKeyRegistryEntry = typeof signingKeyRegistryTable.$inferSelect;
export type KeyStatus = "ACTIVE" | "RETIRED" | "REVOKED";
