import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, emissionsRecordsTable, ledgerEntriesTable } from "@workspace/db";
import {
  GetEmissionsResponse,
  GetEmissionsQueryParams,
  GetVesselEmissionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/emissions", async (req, res): Promise<void> => {
  const query = GetEmissionsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { vesselId, scope } = query.data;
  const conditions = [];
  if (vesselId != null) conditions.push(eq(emissionsRecordsTable.vesselId, vesselId));
  if (scope != null) conditions.push(eq(emissionsRecordsTable.scope, scope));

  const records = await db.select().from(emissionsRecordsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(emissionsRecordsTable.computedAt)
    .limit(200);

  const serialized = records.map((r) => ({
    ...r,
    regulatoryProfileId: r.regulatoryProfileId ?? null,
    computedAt: r.computedAt.toISOString(),
  }));

  res.json(GetEmissionsResponse.parse(serialized));
});

router.get("/emissions/vessel/:vesselId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.vesselId) ? req.params.vesselId[0] : req.params.vesselId;
  const vesselId = parseInt(raw, 10);
  if (isNaN(vesselId)) { res.status(400).json({ error: "Invalid vesselId" }); return; }

  const rows = await db.execute(sql`
    SELECT
      SUM(co2_kg) AS "totalCo2Kg",
      SUM(ch4_kg) AS "totalCh4Kg",
      SUM(n2o_kg) AS "totalN2oKg",
      SUM(co2e_kg) AS "totalCo2eKg",
      SUM(CASE WHEN scope = 'WTW' THEN co2e_kg ELSE 0 END) AS "wtwCo2eKg",
      SUM(CASE WHEN scope = 'TTW' THEN co2e_kg ELSE 0 END) AS "ttwCo2eKg",
      COUNT(*) AS "recordCount"
    FROM emissions_records
    WHERE vessel_id = ${vesselId}
  `);

  const row = rows.rows[0] as Record<string, unknown>;
  const summary = {
    vesselId,
    totalCo2Kg: Number(row?.totalCo2Kg ?? 0),
    totalCh4Kg: Number(row?.totalCh4Kg ?? 0),
    totalN2oKg: Number(row?.totalN2oKg ?? 0),
    totalCo2eKg: Number(row?.totalCo2eKg ?? 0),
    wtwCo2eKg: Number(row?.wtwCo2eKg ?? 0),
    ttwCo2eKg: Number(row?.ttwCo2eKg ?? 0),
    recordCount: Number(row?.recordCount ?? 0),
  };

  res.json(GetVesselEmissionsResponse.parse(summary));
});

export default router;
