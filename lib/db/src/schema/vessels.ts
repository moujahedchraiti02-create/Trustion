import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vesselsTable = pgTable("vessels", {
  id: serial("id").primaryKey(),
  imoNumber: text("imo_number").notNull().unique(),
  name: text("name").notNull(),
  flag: text("flag").notNull(),
  vesselType: text("vessel_type").notNull(),
  grossTonnage: real("gross_tonnage").notNull(),
  reportingYear: integer("reporting_year").notNull(),
  status: text("status", { enum: ["ACTIVE", "INACTIVE", "DRYDOCK"] }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVesselSchema = createInsertSchema(vesselsTable).omit({ id: true, createdAt: true });
export type InsertVessel = z.infer<typeof insertVesselSchema>;
export type Vessel = typeof vesselsTable.$inferSelect;
