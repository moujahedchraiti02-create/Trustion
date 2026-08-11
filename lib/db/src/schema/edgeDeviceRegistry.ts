/**
 * Edge device identity registry — S³V TRUSTION
 *
 * Each row represents one physical or virtual edge measurement device
 * authorized to submit cryptographically source-signed evidence for a
 * specific vessel.  A device is bound to exactly one vessel at registration
 * and that binding cannot be changed without re-registration.
 *
 * Security invariants:
 *   1. Private device keys are NEVER stored here or anywhere on the server.
 *   2. keyId is always derived server-side as SHA-256(publicKey bytes).
 *   3. A REVOKED device cannot submit new evidence; its historical evidence
 *      remains preserved and independently verifiable.
 *   4. The model is forward-compatible with TPM/HSM-backed keys — the
 *      public key is the authoritative credential regardless of the key
 *      generation environment.
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";

export const edgeDeviceRegistryTable = pgTable("edge_device_registry", {
  /** Server-assigned UUID; never supplied by the registering caller. */
  deviceId: text("device_id").primaryKey(),

  /** Vessel this device is authorized to submit evidence for. */
  vesselId: integer("vessel_id")
    .notNull()
    .references(() => vesselsTable.id),

  /**
   * SHA-256 of the publicKey hex string, expressed as 64 lowercase hex chars.
   * Computed server-side on registration — same derivation as signing key keyId.
   */
  keyId: text("key_id").notNull().unique(),

  /**
   * Ed25519 public key, 32 bytes expressed as 64 lowercase hex chars.
   * The private key MUST NOT be stored here or transmitted to this server.
   */
  publicKey: text("public_key").notNull().unique(),

  /** Human-readable label, e.g. "Vessel Alpha — Engine Room Meter A". */
  label: text("label").notNull(),

  status: text("status", { enum: ["ACTIVE", "RETIRED", "REVOKED"] })
    .notNull()
    .default("ACTIVE"),

  activatedAt: timestamp("activated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** Set when the device is intentionally decommissioned (planned retirement). */
  retiredAt: timestamp("retired_at", { withTimezone: true }),

  /**
   * Set when the device is revoked due to compromise or security event.
   * Distinct from retiredAt: revokedAt is the forensic timestamp used to
   * determine whether historical signatures predate the revocation declaration.
   */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  revocationReason: text("revocation_reason"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertEdgeDeviceSchema = createInsertSchema(edgeDeviceRegistryTable).omit({
  deviceId: true,
  createdAt: true,
  activatedAt: true,
});

export type InsertEdgeDevice = z.infer<typeof insertEdgeDeviceSchema>;
export type EdgeDevice = typeof edgeDeviceRegistryTable.$inferSelect;
