import { pgTable, text, serial, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  vesselId: integer("vessel_id").notNull().references(() => vesselsTable.id),
  eventType: text("event_type").notNull(),
  timestampGnss: timestamp("timestamp_gnss", { withTimezone: true }).notNull(),
  timestampDevice: timestamp("timestamp_device", { withTimezone: true }),
  timestampServer: timestamp("timestamp_server", { withTimezone: true }).notNull().defaultNow(),
  temporalTrust: text("temporal_trust", { enum: ["TRUSTED_GNSS", "BACKFILL", "DRIFT_WARNING"] }).notNull().default("TRUSTED_GNSS"),
  fuelType: text("fuel_type").notNull(),
  fuelMassKg: real("fuel_mass_kg").notNull(),
  engineLoadPct: real("engine_load_pct").notNull(),
  positionLat: real("position_lat"),
  positionLon: real("position_lon"),
  rawHash: text("raw_hash").notNull(),
  prevHash: text("prev_hash"),
  chainHash: text("chain_hash").notNull(),
  signature: text("signature"),
  signerMode: text("signer_mode", { enum: ["TPM2", "SOFTWARE_ED25519", "UNSIGNED"] }).notNull().default("SOFTWARE_ED25519"),
  isEstimated: boolean("is_estimated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntriesTable).omit({ id: true, createdAt: true, timestampServer: true });
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;
export type LedgerEntry = typeof ledgerEntriesTable.$inferSelect;
