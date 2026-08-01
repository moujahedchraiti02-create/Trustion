import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function getVesselEmissionsSummaryData(vesselId: number) {
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
  return {
    vesselId,
    totalCo2Kg: Number(row?.totalCo2Kg ?? 0),
    totalCh4Kg: Number(row?.totalCh4Kg ?? 0),
    totalN2oKg: Number(row?.totalN2oKg ?? 0),
    totalCo2eKg: Number(row?.totalCo2eKg ?? 0),
    wtwCo2eKg: Number(row?.wtwCo2eKg ?? 0),
    ttwCo2eKg: Number(row?.ttwCo2eKg ?? 0),
    recordCount: Number(row?.recordCount ?? 0),
  };
}
