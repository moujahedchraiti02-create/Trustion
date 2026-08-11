import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tamper-evident, append-only signing key registry.
 *
 * Rules:
 *  - Records are never deleted.
 *  - key_id is the stable identifier for each Ed25519 identity (SHA-256 of
 *    the public key bytes, 64 hex chars).  It is distinct from the fingerprint
 *    (first 16 hex chars).
 *  - Status transitions are additive: ACTIVE → RETIRED | REVOKED.
 *    REVOKED entries keep their revocation_reason permanently.
 *  - Private key material is NEVER stored here.
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
  revocationReason: text("revocation_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SigningKeyRegistryEntry = typeof signingKeyRegistryTable.$inferSelect;
export type KeyStatus = "ACTIVE" | "RETIRED" | "REVOKED";
