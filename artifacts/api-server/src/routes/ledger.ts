import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, ledgerEntriesTable, vesselsTable } from "@workspace/db";
import {
  GetLedgerEntriesResponse,
  GetLedgerEntriesQueryParams,
  IngestLedgerEntryBody,
  GetLedgerEntryResponse,
  GetLedgerChainStatusResponse,
} from "@workspace/api-zod";
import { computeRawHash, computeChainHash, buildMerkleProof, signPayload } from "../lib/crypto";
import { requireRole } from "../middleware/auth";
import { chainStatusLimiter, writeLimiter } from "../middleware/rateLimiter";

// OPERATOR and EDGE_INGEST may both ingest ledger evidence.
// AUDITOR and ADMIN cannot — they have no operational write authority.
const requireOperatorOrEdge = requireRole("OPERATOR", "EDGE_INGEST");

/**
 * Hard server-side ceiling on ledger entry list queries.
 * Exported so automated tests can assert the cap is respected without
 * hard-coding the constant in multiple places.
 */
export const LEDGER_QUERY_MAX_LIMIT = 500;

const router: IRouter = Router();

router.get("/ledger/entries", async (req, res): Promise<void> => {
  const query = GetLedgerEntriesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const { vesselId, temporalTrust, limit } = query.data;

  // Enforce a hard server-side ceiling regardless of the caller-supplied value.
  const effectiveLimit = Math.min(limit ?? 50, LEDGER_QUERY_MAX_LIMIT);

  const conditions = [];
  if (vesselId != null) conditions.push(eq(ledgerEntriesTable.vesselId, vesselId));
  if (temporalTrust != null) conditions.push(eq(ledgerEntriesTable.temporalTrust, temporalTrust));

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
      signerMode: ledgerEntriesTable.signerMode,
      isEstimated: ledgerEntriesTable.isEstimated,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .leftJoin(vesselsTable, eq(ledgerEntriesTable.vesselId, vesselsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ledgerEntriesTable.createdAt))
    .limit(effectiveLimit);

  const serialized = entries.map((e) => ({
    ...e,
    vesselName: e.vesselName ?? null,
    timestampGnss: e.timestampGnss.toISOString(),
    timestampDevice: e.timestampDevice?.toISOString() ?? null,
    timestampServer: e.timestampServer?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  }));

  res.json(GetLedgerEntriesResponse.parse(serialized));
});

router.post("/ledger/entries", requireOperatorOrEdge, writeLimiter, async (req, res): Promise<void> => {
  const parsed = IngestLedgerEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data = parsed.data;
  // Discard any caller-supplied signature — the server always computes its own.
  const { signature: _providedSignature, ...eventPayload } = data;
  const { signature, publicKey } = signPayload(eventPayload);

  // Get the previous entry to build the chain hash.
  const [prev] = await db
    .select({ chainHash: ledgerEntriesTable.chainHash, id: ledgerEntriesTable.id })
    .from(ledgerEntriesTable)
    .orderBy(desc(ledgerEntriesTable.id))
    .limit(1);

  const prevHash = prev?.chainHash ?? null;
  const rawHash = computeRawHash({
    vesselId: data.vesselId,
    eventType: data.eventType,
    timestampGnss: data.timestampGnss,
    fuelType: data.fuelType,
    fuelMassKg: data.fuelMassKg,
    engineLoadPct: data.engineLoadPct,
  });
  const chainHash = computeChainHash(rawHash, prevHash);

  // Classify temporal trust based on GNSS vs server clock skew.
  let temporalTrust: "TRUSTED_GNSS" | "BACKFILL" | "DRIFT_WARNING" = "TRUSTED_GNSS";
  const gnssTime = new Date(data.timestampGnss).getTime();
  const serverTime = Date.now();
  const diffMs = Math.abs(serverTime - gnssTime);
  if (diffMs > 24 * 60 * 60 * 1000) temporalTrust = "BACKFILL";
  else if (diffMs > 5 * 60 * 1000) temporalTrust = "DRIFT_WARNING";

  const [entry] = await db.insert(ledgerEntriesTable).values({
    vesselId: data.vesselId,
    eventType: data.eventType,
    timestampGnss: new Date(data.timestampGnss),
    timestampDevice: data.timestampDevice ? new Date(data.timestampDevice) : null,
    fuelType: data.fuelType,
    fuelMassKg: data.fuelMassKg,
    engineLoadPct: data.engineLoadPct,
    positionLat: data.positionLat ?? null,
    positionLon: data.positionLon ?? null,
    rawHash,
    prevHash,
    chainHash,
    signature,
    publicKey,
    signerMode: "SOFTWARE_ED25519",
    isEstimated: data.isEstimated ?? false,
    temporalTrust,
  }).returning();

  const [vessel] = await db
    .select({ name: vesselsTable.name })
    .from(vesselsTable)
    .where(eq(vesselsTable.id, entry.vesselId));

  const serialized = {
    ...entry,
    vesselName: vessel?.name ?? null,
    timestampGnss: entry.timestampGnss.toISOString(),
    timestampDevice: entry.timestampDevice?.toISOString() ?? null,
    timestampServer: entry.timestampServer?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
  };

  res.status(201).json(serialized);
});

router.get("/ledger/entries/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [entry] = await db
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
      signerMode: ledgerEntriesTable.signerMode,
      isEstimated: ledgerEntriesTable.isEstimated,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .leftJoin(vesselsTable, eq(ledgerEntriesTable.vesselId, vesselsTable.id))
    .where(eq(ledgerEntriesTable.id, id));

  if (!entry) { res.status(404).json({ error: "Not found" }); return; }

  // Build Merkle proof for this entry's position in the chain.
  const allEntries = await db
    .select({ id: ledgerEntriesTable.id, chainHash: ledgerEntriesTable.chainHash })
    .from(ledgerEntriesTable)
    .orderBy(ledgerEntriesTable.id);
  const idx = allEntries.findIndex((e) => e.id === id);
  const merkleProof = buildMerkleProof(allEntries, idx);

  // Validate the stored chain hash against a freshly computed one.
  const rawHashCheck = computeRawHash({
    vesselId: entry.vesselId,
    eventType: entry.eventType,
    timestampGnss: entry.timestampGnss.toISOString(),
    fuelType: entry.fuelType,
    fuelMassKg: entry.fuelMassKg,
    engineLoadPct: entry.engineLoadPct,
  });
  const expectedChain = computeChainHash(rawHashCheck, entry.prevHash);
  const chainValid = expectedChain === entry.chainHash;

  const serialized = {
    ...entry,
    vesselName: entry.vesselName ?? null,
    timestampGnss: entry.timestampGnss.toISOString(),
    timestampDevice: entry.timestampDevice?.toISOString() ?? null,
    timestampServer: entry.timestampServer?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
  };

  res.json(GetLedgerEntryResponse.parse({ entry: serialized, merkleProof, chainValid }));
});

router.get("/ledger/chain-status", chainStatusLimiter, async (req, res): Promise<void> => {
  const entries = await db.select({
    id: ledgerEntriesTable.id,
    chainHash: ledgerEntriesTable.chainHash,
    prevHash: ledgerEntriesTable.prevHash,
    rawHash: ledgerEntriesTable.rawHash,
    vesselId: ledgerEntriesTable.vesselId,
    eventType: ledgerEntriesTable.eventType,
    timestampGnss: ledgerEntriesTable.timestampGnss,
    fuelType: ledgerEntriesTable.fuelType,
    fuelMassKg: ledgerEntriesTable.fuelMassKg,
    engineLoadPct: ledgerEntriesTable.engineLoadPct,
  }).from(ledgerEntriesTable).orderBy(ledgerEntriesTable.id);

  let integrityStatus: "INTACT" | "BROKEN" | "UNKNOWN" = "UNKNOWN";
  let brokenAtEntry: number | null = null;

  if (entries.length === 0) {
    integrityStatus = "INTACT";
  } else {
    integrityStatus = "INTACT";
    for (const entry of entries) {
      const rawHash = computeRawHash({
        vesselId: entry.vesselId,
        eventType: entry.eventType,
        timestampGnss: entry.timestampGnss.toISOString(),
        fuelType: entry.fuelType,
        fuelMassKg: entry.fuelMassKg,
        engineLoadPct: entry.engineLoadPct,
      });
      const expectedChain = computeChainHash(rawHash, entry.prevHash);
      if (expectedChain !== entry.chainHash) {
        integrityStatus = "BROKEN";
        brokenAtEntry = entry.id;
        break;
      }
    }
  }

  const lastEntry = entries[entries.length - 1];
  const result = {
    totalEntries: entries.length,
    lastHash: lastEntry?.chainHash ?? null,
    integrityStatus,
    brokenAtEntry,
    checkedAt: new Date().toISOString(),
  };
  res.json(GetLedgerChainStatusResponse.parse(result));
});

export default router;
