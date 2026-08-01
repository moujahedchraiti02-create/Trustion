import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, vesselsTable, ledgerEntriesTable, emissionsRecordsTable, alertsTable } from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetDashboardRecentEventsResponse,
  GetDashboardAlertBreakdownResponse,
} from "@workspace/api-zod";
import { getLedgerChainStatusData } from "./ledger-helpers";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [vesselCounts] = (await db.execute(sql`
    SELECT
      COUNT(*) AS "totalVessels",
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS "activeVessels"
    FROM vessels
  `)).rows as Record<string, unknown>[];

  const [ledgerCount] = (await db.execute(sql`
    SELECT COUNT(*) AS total FROM ledger_entries
  `)).rows as Record<string, unknown>[];

  const [emissionsTotal] = (await db.execute(sql`
    SELECT SUM(co2e_kg) AS "totalCo2eKg" FROM emissions_records
  `)).rows as Record<string, unknown>[];

  const [alertCount] = (await db.execute(sql`
    SELECT COUNT(*) AS "openAlerts" FROM alerts WHERE acknowledged = false
  `)).rows as Record<string, unknown>[];

  const [lastEntry] = (await db.execute(sql`
    SELECT timestamp_server FROM ledger_entries ORDER BY id DESC LIMIT 1
  `)).rows as Record<string, unknown>[];

  const chainStatus = await getLedgerChainStatusData();

  const summary = {
    totalVessels: Number(vesselCounts?.totalVessels ?? 0),
    activeVessels: Number(vesselCounts?.activeVessels ?? 0),
    totalLedgerEntries: Number(ledgerCount?.total ?? 0),
    totalCo2eKg: Number(emissionsTotal?.totalCo2eKg ?? 0),
    openAlerts: Number(alertCount?.openAlerts ?? 0),
    chainIntegrity: chainStatus.integrityStatus,
    lastIngestAt: lastEntry?.timestamp_server
      ? new Date(lastEntry.timestamp_server as string).toISOString()
      : null,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

router.get("/dashboard/recent-events", async (req, res): Promise<void> => {
  const entries = await db
    .select({
      id: ledgerEntriesTable.id,
      vesselId: ledgerEntriesTable.vesselId,
      vesselName: vesselsTable.name,
      eventType: ledgerEntriesTable.eventType,
      timestampGnss: ledgerEntriesTable.timestampGnss,
      timestampDevice: ledgerEntriesTable.timestampDevice,
      timestampServer: ledgerEntriesTable.timestampServer,
      temporalTrust: ledgerEntriesTable.temporalTrust,
      fuelType: ledgerEntriesTable.fuelType,
      fuelMassKg: ledgerEntriesTable.fuelMassKg,
      engineLoadPct: ledgerEntriesTable.engineLoadPct,
      positionLat: ledgerEntriesTable.positionLat,
      positionLon: ledgerEntriesTable.positionLon,
      rawHash: ledgerEntriesTable.rawHash,
      prevHash: ledgerEntriesTable.prevHash,
      chainHash: ledgerEntriesTable.chainHash,
      signature: ledgerEntriesTable.signature,
      signerMode: ledgerEntriesTable.signerMode,
      isEstimated: ledgerEntriesTable.isEstimated,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .leftJoin(vesselsTable, eq(ledgerEntriesTable.vesselId, vesselsTable.id))
    .orderBy(desc(ledgerEntriesTable.createdAt))
    .limit(10);

  const serialized = entries.map((e) => ({
    ...e,
    vesselName: e.vesselName ?? null,
    timestampGnss: e.timestampGnss.toISOString(),
    timestampDevice: e.timestampDevice?.toISOString() ?? null,
    timestampServer: e.timestampServer?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }));

  res.json(GetDashboardRecentEventsResponse.parse(serialized));
});

router.get("/dashboard/alert-breakdown", async (req, res): Promise<void> => {
  const [row] = (await db.execute(sql`
    SELECT
      SUM(CASE WHEN severity = 'WATCH' AND acknowledged = false THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN severity = 'LEGAL_WARNING' AND acknowledged = false THEN 1 ELSE 0 END) AS "legalWarning",
      SUM(CASE WHEN severity = 'THRESHOLD_EXCEEDED' AND acknowledged = false THEN 1 ELSE 0 END) AS "thresholdExceeded"
    FROM alerts
  `)).rows as Record<string, unknown>[];

  const breakdown = {
    watch: Number(row?.watch ?? 0),
    legalWarning: Number(row?.legalWarning ?? 0),
    thresholdExceeded: Number(row?.thresholdExceeded ?? 0),
  };

  res.json(GetDashboardAlertBreakdownResponse.parse(breakdown));
});

export default router;
