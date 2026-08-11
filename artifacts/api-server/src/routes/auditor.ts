import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, auditorDecisionsTable, ledgerEntriesTable, emissionsRecordsTable, vesselsTable } from "@workspace/db";
import {
  GetAuditorEvidenceResponse,
  GetAuditorDecisionsResponse,
  SubmitAuditorDecisionBody,
} from "@workspace/api-zod";
import { sha256 } from "../lib/crypto";
import { getLedgerChainStatusData } from "./ledger-helpers";
import { getVesselEmissionsSummaryData } from "./emissions-helpers";
import { requireRole } from "../middleware/auth";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

// All auditor routes require the AUDITOR credential.
// OPERATOR and ADMIN cannot access these endpoints — the legal firewall
// prevents operators from self-approving their own evidence submissions.
const requireAuditor = requireRole("AUDITOR");

router.get("/auditor/evidence/:vesselId", requireAuditor, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.vesselId) ? req.params.vesselId[0] : req.params.vesselId;
  const vesselId = parseInt(raw, 10);
  if (isNaN(vesselId)) { res.status(400).json({ error: "Invalid vesselId" }); return; }

  const [vessel] = await db.select().from(vesselsTable).where(eq(vesselsTable.id, vesselId));
  if (!vessel) { res.status(404).json({ error: "Not found" }); return; }

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
    .where(eq(ledgerEntriesTable.vesselId, vesselId))
    .orderBy(ledgerEntriesTable.id);

  const serializedEntries = entries.map((e) => ({
    ...e,
    vesselName: e.vesselName ?? null,
    timestampGnss: e.timestampGnss.toISOString(),
    timestampDevice: e.timestampDevice?.toISOString() ?? null,
    timestampServer: e.timestampServer?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }));

  const emissionsSummary = await getVesselEmissionsSummaryData(vesselId);
  const chainStatus = await getLedgerChainStatusData();
  const decisions = await db.select().from(auditorDecisionsTable)
    .where(eq(auditorDecisionsTable.vesselId, vesselId))
    .orderBy(desc(auditorDecisionsTable.createdAt));

  const serializedDecisions = decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));

  const pkg = {
    vesselId,
    generatedAt: new Date().toISOString(),
    ledgerEntries: serializedEntries,
    emissionsSummary,
    chainStatus,
    decisions: serializedDecisions,
  };
  res.json(GetAuditorEvidenceResponse.parse(pkg));
});

router.get("/auditor/decisions", requireAuditor, async (req, res): Promise<void> => {
  const decisions = await db.select().from(auditorDecisionsTable).orderBy(desc(auditorDecisionsTable.createdAt));
  const serialized = decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));
  res.json(GetAuditorDecisionsResponse.parse(serialized));
});

router.post("/auditor/decisions", requireAuditor, writeLimiter, async (req, res): Promise<void> => {
  const parsed = SubmitAuditorDecisionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // The verifierId is always derived from the authenticated session.
  // Any verifierId supplied in the request body is explicitly overridden here
  // to prevent audit-trail forgery and to enforce the legal firewall principle
  // that verifier identity must be established by the server, not the caller.
  const verifierId = req.auth!.subject;

  const [decision] = await db.insert(auditorDecisionsTable).values({
    ...parsed.data,
    verifierId,
  }).returning();

  res.status(201).json({ ...decision, createdAt: decision.createdAt.toISOString() });
});

export default router;
