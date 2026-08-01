import { pgTable, text, serial, timestamp, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const regulatoryProfilesTable = pgTable("regulatory_profiles", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  jurisdiction: text("jurisdiction", { enum: ["FuelEU", "IMO_DCS", "MARPOL", "CII"] }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  co2Factor: real("co2_factor").notNull(),
  ch4Gwp: real("ch4_gwp").notNull(),
  n2oGwp: real("n2o_gwp").notNull(),
  methaneSlipDefault: real("methane_slip_default").notNull(),
  maxDataGapPct: real("max_data_gap_pct").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRegulatoryProfileSchema = createInsertSchema(regulatoryProfilesTable).omit({ id: true, createdAt: true });
export type InsertRegulatoryProfile = z.infer<typeof insertRegulatoryProfileSchema>;
export type RegulatoryProfile = typeof regulatoryProfilesTable.$inferSelect;
