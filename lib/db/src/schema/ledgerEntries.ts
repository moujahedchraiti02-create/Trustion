import {
  pgTable,
  text,
  serial,
  timestamp,
  real,
  integer,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";

export const ledgerEntriesTable = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    vesselId: integer("vessel_id")
      .notNull()
      .references(() => vesselsTable.id),
    eventType: text("event_type").notNull(),
    timestampGnss: timestamp("timestamp_gnss", { withTimezone: true }).notNull(),
    timestampDevice: timestamp("timestamp_device", { withTimezone: true }),
    timestampServer: timestamp("timestamp_server", { withTimezone: true })
      .notNull()
      .defaultNow(),
    temporalTrust: text("temporal_trust", {
      enum: ["TRUSTED_GNSS", "BACKFILL", "DRIFT_WARNING"],
    })
      .notNull()
      .default("TRUSTED_GNSS"),
    fuelType: text("fuel_type").notNull(),
    fuelMassKg: real("fuel_mass_kg").notNull(),
    engineLoadPct: real("engine_load_pct").notNull(),
    positionLat: real("position_lat"),
    positionLon: real("position_lon"),
    rawHash: text("raw_hash").notNull(),
    prevHash: text("prev_hash"),
    chainHash: text("chain_hash").notNull(),

    // ── TRUSTION server receipt signature ───────────────────────────────────
    // Assertion: "The TRUSTION server accepted and committed this evidence."
    signature: text("signature"),
    publicKey: text("public_key"),
    /** FK into signing_key_registry.key_id; nullable for pre-registry entries. */
    keyId: text("key_id"),
    signerMode: text("signer_mode", {
      enum: ["TPM2", "SOFTWARE_ED25519", "UNSIGNED"],
    })
      .notNull()
      .default("SOFTWARE_ED25519"),

    // ── Edge device source signature provenance ─────────────────────────────
    // Assertion: "This registered Edge device signed this measurement."
    // Null for OPERATOR-originated submissions.
    /**
     * FK into edge_device_registry.device_id; null for OPERATOR submissions.
     * Non-null means evidence was submitted by an authenticated, registered
     * edge device and has been source-signed.
     */
    sourceDeviceId: text("source_device_id"),

    /** Device key_id (SHA-256 of device public key) at time of signing. */
    sourceKeyId: text("source_key_id"),

    /**
     * Ed25519 signature from the device over the canonical evidence payload.
     * The canonical payload is stableJsonStringify({
     *   deviceId, vesselId, eventType, timestampGnss, timestampDevice,
     *   fuelType, fuelMassKg, engineLoadPct, positionLat, positionLon,
     *   deviceSequenceNumber
     * }) where keys are alphabetically sorted.
     */
    sourceSignature: text("source_signature"),

    /** Signing mode of the device key at time of submission. */
    sourceSigningMode: text("source_signing_mode", {
      enum: ["EDGE_ED25519"],
    }),

    /**
     * Device-local monotonic sequence counter for anti-replay protection.
     * Combined with sourceDeviceId, enforced unique by DB index.
     * Null for OPERATOR submissions.
     */
    deviceSequenceNumber: integer("device_sequence_number"),

    isEstimated: boolean("is_estimated").notNull().default(false),

    // ── Chain epoch assignment ───────────────────────────────────────────────
    /**
     * FK into chain_epochs.epoch_id; null for entries created before epoch
     * support was introduced (legacy MD5-era entries 1–19) or for entries
     * submitted when no epoch was OPEN for the vessel.
     *
     * Caller cannot choose this value — it is server-derived at ingest time
     * by locking the current OPEN epoch for the vessel.
     */
    chainEpochId: text("chain_epoch_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Prevents duplicate or replayed device sequence numbers.
     * Postgres NULL semantics: NULL != NULL, so OPERATOR rows (both columns null)
     * do not conflict with each other.  Only (deviceId, seqNum) pairs where
     * both are non-null are checked for uniqueness.
     */
    uniqueIndex("ledger_device_seq_unique_idx").on(
      t.sourceDeviceId,
      t.deviceSequenceNumber,
    ),
  ],
);

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntriesTable).omit({
  id: true,
  createdAt: true,
  timestampServer: true,
});
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
