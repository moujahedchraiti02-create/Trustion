import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";
import { ledgerEntriesTable } from "./ledgerEntries";
import { regulatoryProfilesTable } from "./regulatoryProfiles";

export const emissionsRecordsTable = pgTable("emissions_records", {
  id: serial("id").primaryKey(),
  vesselId: integer("vessel_id").notNull().references(() => vesselsTable.id),
  ledgerEntryId: integer("ledger_entry_id").notNull().references(() => ledgerEntriesTable.id),
  scope: text("scope", { enum: ["WTW", "TTW"] }).notNull(),
  co2Kg: real("co2_kg").notNull(),
  ch4Kg: real("ch4_kg").notNull(),
  n2oKg: real("n2o_kg").notNull(),
  co2eKg: real("co2e_kg").notNull(),
  wtwFactor: real("wtw_factor").notNull(),
  ttwFactor: real("ttw_factor").notNull(),
  methaneSlipMethod: text("methane_slip_method", {
    enum: ["REGULATORY_DEFAULT", "BIN_INTERPOLATION", "VERIFIED_ACTUAL"],
  }).notNull().default("REGULATORY_DEFAULT"),
  regulatoryProfileId: integer("regulatory_profile_id").references(() => regulatoryProfilesTable.id),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmissionsRecordSchema = createInsertSchema(emissionsRecordsTable).omit({ id: true, computedAt: true });
export type InsertEmissionsRecord = z.infer<typeof insertEmissionsRecordSchema>;
export type EmissionsRecord = typeof emissionsRecordsTable.$inferSelect;
