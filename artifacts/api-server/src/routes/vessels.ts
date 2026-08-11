import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, vesselsTable, ledgerEntriesTable, emissionsRecordsTable, regulatoryProfilesTable, alertsTable } from "@workspace/db";
import {
  GetVesselsResponse,
  CreateVesselBody,
  GetVesselResponse,
  GetVesselComplianceResponse,
  GetVesselEmissionsTrendResponse,
} from "@workspace/api-zod";
import { requireApiKey } from "../middleware/auth";

const router: IRouter = Router();

router.get("/vessels", async (req, res): Promise<void> => {
  const vessels = await db.select().from(vesselsTable).orderBy(vesselsTable.name);
  res.json(GetVesselsResponse.parse(vessels));
});

router.post("/vessels", requireApiKey, async (req, res): Promise<void> => {
  const parsed = CreateVesselBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vessel] = await db.insert(vesselsTable).values(parsed.data).returning();
  res.status(201).json(vessel);
});

router.get("/vessels/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [vessel] = await db.select().from(vesselsTable).where(eq(vesselsTable.id, id));
  if (!vessel) { res.status(404).json({ error: "Not found" }); return; }
  res.json(GetVesselResponse.parse(vessel));
});

router.get("/vessels/:id/compliance", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [vessel] = await db.select().from(vesselsTable).where(eq(vesselsTable.id, id));
  if (!vessel) { res.status(404).json({ error: "Not found" }); return; }

  // Compute compliance metrics
  const entries = await db.select({
    isEstimated: ledgerEntriesTable.isEstimated,
    temporalTrust: ledgerEntriesTable.temporalTrust,
  }).from(ledgerEntriesTable).where(eq(ledgerEntriesTable.vesselId, id));

  const total = entries.length;
  const estimatedCount = entries.filter((e) => e.isEstimated).length;
  const unverifiedCount = entries.filter((e) => e.temporalTrust === "DRIFT_WARNING").length;
  const gapCount = entries.filter((e) => e.temporalTrust === "BACKFILL").length;

  const estimatedPct = total > 0 ? (estimatedCount / total) * 100 : 0;
  const unverifiedPct = total > 0 ? (unverifiedCount / total) * 100 : 0;
  const dataGapPct = total > 0 ? (gapCount / total) * 100 : 0;

  // Get active regulatory profile
  const [profile] = await db.select({ name: regulatoryProfilesTable.name })
    .from(regulatoryProfilesTable)
    .orderBy(regulatoryProfilesTable.effectiveDate)
    .limit(1);

  const maxGap = 5; // % threshold
  let overallStatus: "COMPLIANT" | "AT_RISK" | "NON_COMPLIANT" = "COMPLIANT";
  if (dataGapPct > maxGap * 2 || estimatedPct > 20) overallStatus = "NON_COMPLIANT";
  else if (dataGapPct > maxGap || estimatedPct > 10 || unverifiedPct > 5) overallStatus = "AT_RISK";

  const result = {
    vesselId: id,
    reportingYear: vessel.reportingYear,
    dataGapPct: Math.round(dataGapPct * 100) / 100,
    estimatedPct: Math.round(estimatedPct * 100) / 100,
    unverifiedPct: Math.round(unverifiedPct * 100) / 100,
    overallStatus,
    regulatoryProfile: profile?.name ?? null,
  };
  res.json(GetVesselComplianceResponse.parse(result));
});

router.get("/vessels/:id/emissions-trend", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(er.computed_at, 'YYYY-MM') AS month,
      SUM(er.co2_kg) AS "co2Kg",
      SUM(er.ch4_kg) AS "ch4Kg",
      SUM(er.n2o_kg) AS "n2oKg",
      SUM(er.co2e_kg) AS "co2eKg"
    FROM emissions_records er
    WHERE er.vessel_id = ${id}
    GROUP BY month
    ORDER BY month
  `);

  const trend = rows.rows.map((r: Record<string, unknown>) => ({
    month: r.month as string,
    co2Kg: Number(r.co2Kg ?? 0),
    ch4Kg: Number(r.ch4Kg ?? 0),
    n2oKg: Number(r.n2oKg ?? 0),
    co2eKg: Number(r.co2eKg ?? 0),
  }));

  res.json(GetVesselEmissionsTrendResponse.parse(trend));
});

export default router;
