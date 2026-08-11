import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, auditorDecisionsTable, ledgerEntriesTable, emissionsRecordsTable, vesselsTable, chainEpochsTable } from "@workspace/db";
import {
  GetAuditorDecisionsResponse,
  SubmitAuditorDecisionBody,
} from "@workspace/api-zod";
import { sha256, verifyPayload } from "../lib/crypto.js";
import { getLedgerChainStatusData } from "./ledger-helpers.js";
import { getVesselEmissionsSummaryData } from "./emissions-helpers.js";
import { getDevicesByIds } from "../lib/edgeDevice.js";
import { requireRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimiter.js";

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
      publicKey: ledgerEntriesTable.publicKey,
      keyId: ledgerEntriesTable.keyId,
      signerMode: ledgerEntriesTable.signerMode,
      isEstimated: ledgerEntriesTable.isEstimated,
      createdAt: ledgerEntriesTable.createdAt,
      // Source provenance fields (null for OPERATOR submissions)
      sourceDeviceId: ledgerEntriesTable.sourceDeviceId,
      sourceKeyId: ledgerEntriesTable.sourceKeyId,
      sourceSignature: ledgerEntriesTable.sourceSignature,
      sourceSigningMode: ledgerEntriesTable.sourceSigningMode,
      deviceSequenceNumber: ledgerEntriesTable.deviceSequenceNumber,
      // Chain epoch anchor (null for legacy/pre-epoch entries)
      chainEpochId: ledgerEntriesTable.chainEpochId,
    })
    .from(ledgerEntriesTable)
    .leftJoin(vesselsTable, eq(ledgerEntriesTable.vesselId, vesselsTable.id))
    .where(eq(ledgerEntriesTable.vesselId, vesselId))
    .orderBy(ledgerEntriesTable.id);

  // ── Fetch device registry records for source-signed entries ───────────────
  const deviceIds = [
    ...new Set(
      entries
        .map((e) => e.sourceDeviceId)
        .filter((id): id is string => id != null),
    ),
  ];
  const deviceMap = await getDevicesByIds(deviceIds);

  // ── Batch-fetch chain epoch records for epoch-assigned entries ────────────
  const uniqueEpochIds = [
    ...new Set(
      entries
        .map((e) => e.chainEpochId)
        .filter((id): id is string => id != null),
    ),
  ];
  const epochMap = new Map<
    string,
    { status: string; merkleRoot: string | null; algorithm: string }
  >();
  if (uniqueEpochIds.length > 0) {
    const epochs = await db
      .select({
        epochId: chainEpochsTable.epochId,
        status: chainEpochsTable.status,
        merkleRoot: chainEpochsTable.merkleRoot,
        algorithm: chainEpochsTable.algorithm,
      })
      .from(chainEpochsTable)
      .where(inArray(chainEpochsTable.epochId, uniqueEpochIds));
    for (const epoch of epochs) {
      epochMap.set(epoch.epochId, epoch);
    }
  }

  // ── Enrich each entry with source provenance verification context ─────────
  const serializedEntries = entries.map((e) => {
    const base = {
      ...e,
      vesselName: e.vesselName ?? null,
      timestampGnss: e.timestampGnss.toISOString(),
      timestampDevice: e.timestampDevice?.toISOString() ?? null,
      timestampServer: e.timestampServer?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    };

    // ── Epoch anchor context (applies to all entries regardless of provenance) ─
    const epochCtx = e.chainEpochId ? (epochMap.get(e.chainEpochId) ?? null) : null;

    // OPERATOR submission — no source device provenance.
    if (!e.sourceDeviceId || !e.sourceSignature || !e.sourceKeyId) {
      return {
        ...base,
        provenanceType: "OPERATOR" as const,
        sourceDevice: null,
        // Epoch anchor fields — null for LEGACY/unassigned entries
        chainEpochId: e.chainEpochId ?? null,
        epochStatus: epochCtx?.status ?? null,
        epochMerkleRoot: epochCtx?.merkleRoot ?? null,
        epochAlgorithm: epochCtx?.algorithm ?? null,
      };
    }

    // EDGE submission — enrich with device registry info and signature verification.
    const device = deviceMap.get(e.sourceDeviceId) ?? null;

    let sourceSignatureValid = false;
    if (device && e.sourceSignature) {
      // Reconstruct canonical payload for verification.
      // This uses the same deterministic serialization as at ingest time.
      const canonicalPayload: Record<string, unknown> = {
        deviceId: e.sourceDeviceId,
        deviceSequenceNumber: e.deviceSequenceNumber,
        engineLoadPct: e.engineLoadPct,
        eventType: e.eventType,
        fuelMassKg: e.fuelMassKg,
        fuelType: e.fuelType,
        positionLat: e.positionLat ?? null,
        positionLon: e.positionLon ?? null,
        timestampDevice: e.timestampDevice?.toISOString() ?? null,
        timestampGnss: e.timestampGnss.toISOString(),
        vesselId: e.vesselId,
      };
      sourceSignatureValid = verifyPayload(canonicalPayload, e.sourceSignature, device.publicKey);
    }

    // Temporal revocation context: was the evidence signed before the device was revoked?
    let signedBeforeDeviceRevocation: boolean | null = null;
    if (device?.status === "REVOKED" && device.revokedAt && e.timestampServer) {
      const serverTs = e.timestampServer instanceof Date ? e.timestampServer : new Date(e.timestampServer);
      signedBeforeDeviceRevocation = serverTs.getTime() < device.revokedAt.getTime();
    }

    return {
      ...base,
      provenanceType: "EDGE" as const,
      sourceDevice: device
        ? {
            deviceId: device.deviceId,
            vesselId: device.vesselId,
            keyId: device.keyId,
            publicKey: device.publicKey,
            label: device.label,
            status: device.status,
            activatedAt: device.activatedAt.toISOString(),
            retiredAt: device.retiredAt?.toISOString() ?? null,
            revokedAt: device.revokedAt?.toISOString() ?? null,
            revocationReason: device.revocationReason ?? null,
          }
        : null,
      sourceSignatureValid,
      signedBeforeDeviceRevocation,
      // Epoch anchor fields — null for LEGACY/unassigned entries
      chainEpochId: e.chainEpochId ?? null,
      epochStatus: epochCtx?.status ?? null,
      epochMerkleRoot: epochCtx?.merkleRoot ?? null,
      epochAlgorithm: epochCtx?.algorithm ?? null,
    };
  });

  const emissionsSummary = await getVesselEmissionsSummaryData(vesselId);
  const chainStatus = await getLedgerChainStatusData();
  const decisions = await db
    .select()
    .from(auditorDecisionsTable)
    .where(eq(auditorDecisionsTable.vesselId, vesselId))
    .orderBy(desc(auditorDecisionsTable.createdAt));

  const serializedDecisions = decisions.map((d) => ({
    ...d,
    createdAt: d.createdAt.toISOString(),
  }));

  const pkg = {
    vesselId,
    generatedAt: new Date().toISOString(),
    ledgerEntries: serializedEntries,
    emissionsSummary,
    chainStatus,
    decisions: serializedDecisions,
  };

  // Return directly without running through the generated Zod schema since
  // the ledger entries now include extended device provenance fields.
  res.json(pkg);
});

router.get("/auditor/decisions", requireAuditor, async (_req, res): Promise<void> => {
  const decisions = await db
    .select()
    .from(auditorDecisionsTable)
    .orderBy(desc(auditorDecisionsTable.createdAt));
  const serialized = decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));
  res.json(GetAuditorDecisionsResponse.parse(serialized));
});

router.post(
  "/auditor/decisions",
  requireAuditor,
  writeLimiter,
  async (req, res): Promise<void> => {
    const parsed = SubmitAuditorDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // The verifierId is always derived from the authenticated session.
    // Any verifierId supplied in the request body is explicitly overridden here
    // to prevent audit-trail forgery and to enforce the legal firewall principle
    // that verifier identity must be established by the server, not the caller.
    const verifierId = req.auth!.subject;

    const [decision] = await db
      .insert(auditorDecisionsTable)
      .values({ ...parsed.data, verifierId })
      .returning();

    res.status(201).json({ ...decision, createdAt: decision.createdAt.toISOString() });
  },
);

export default router;
