import { pgTable, text, serial, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  vesselId: integer("vessel_id").references(() => vesselsTable.id),
  alertType: text("alert_type").notNull(),
  severity: text("severity", { enum: ["WATCH", "LEGAL_WARNING", "THRESHOLD_EXCEEDED", "HIGH"] }).notNull(),
  message: text("message").notNull(),
  thresholdPct: real("threshold_pct"),
  currentPct: real("current_pct"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: text("acknowledged_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
