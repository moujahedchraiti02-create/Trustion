import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vesselsTable } from "./vessels";

export const auditorDecisionsTable = pgTable("auditor_decisions", {
  id: serial("id").primaryKey(),
  vesselId: integer("vessel_id").notNull().references(() => vesselsTable.id),
  evidencePackageHash: text("evidence_package_hash").notNull(),
  decision: text("decision", { enum: ["APPROVED", "REJECTED", "PENDING_CLARIFICATION"] }).notNull(),
  rationale: text("rationale").notNull(),
  verifierId: text("verifier_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditorDecisionSchema = createInsertSchema(auditorDecisionsTable).omit({ id: true, createdAt: true });
export type InsertAuditorDecision = z.infer<typeof insertAuditorDecisionSchema>;
export type AuditorDecision = typeof auditorDecisionsTable.$inferSelect;
