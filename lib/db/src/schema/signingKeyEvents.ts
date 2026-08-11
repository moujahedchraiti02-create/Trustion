import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { signingKeyRegistryTable } from "./signingKeyRegistry";

/**
 * Append-only audit log for signing key lifecycle events.
 *
 * This table is the forensic ground truth for key lifecycle history.
 * Rows are NEVER deleted or updated.  Every status transition for every
 * signing key must produce at least one event row here.
 *
 * Event types
 * ───────────
 *   KEY_ACTIVATED — the key became the active signing identity.
 *                   Recorded at first registration AND at re-activation.
 *   KEY_RETIRED   — the key stopped signing (planned rotation or manual
 *                   retirement).  Historical signatures remain verifiable.
 *   KEY_REVOKED   — the key was declared compromised.  The revocation_reason
 *                   and effective_at are forensically significant.
 *
 * Actor format
 * ────────────
 *   "system:startup"   — automated activation at server startup.
 *   "<role>:<subject>" — API-initiated lifecycle change (mirrors auth subject).
 *
 * Offline verifiability
 * ─────────────────────
 * This table can be exported as part of a TRUSTION evidence package so that
 * auditors can determine key lifecycle status without a live API call.
 * The GET /api/key-registry/events endpoint surfaces this data.
 */
export const signingKeyEventsTable = pgTable("signing_key_events", {
  id:          serial("id").primaryKey(),
  keyId:       text("key_id").notNull().references(() => signingKeyRegistryTable.keyId),
  eventType:   text("event_type", { enum: ["KEY_ACTIVATED", "KEY_RETIRED", "KEY_REVOKED"] }).notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  actor:       text("actor").notNull(),
  reason:      text("reason"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SigningKeyEvent = typeof signingKeyEventsTable.$inferSelect;
export type KeyEventType = "KEY_ACTIVATED" | "KEY_RETIRED" | "KEY_REVOKED";
