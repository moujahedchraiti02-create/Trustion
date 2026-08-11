import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { db, ledgerEntriesTable, vesselsTable } from "@workspace/db";
import {
  GetLedgerEntriesResponse,
  GetLedgerEntriesQueryParams,
  IngestLedgerEntryBody,
  GetLedgerEntryResponse,
  GetLedgerChainStatusResponse,
} from "@workspace/api-zod";
import {
  computeRawHash,
  computeChainHash,
  buildMerkleProof,
  signPayload,
  verifyPayload,
} from "../lib/crypto.js";
import { requireRole } from "../middleware/auth.js";
import { chainStatusLimiter, writeLimiter } from "../middleware/rateLimiter.js";
import {
  getDeviceById,
  getMaxDeviceSequence,
  buildDeviceCanonicalPayload,
  isUniqueConstraintError,
} from "../lib/edgeDevice.js";

// OPERATOR and EDGE_INGEST may both ingest ledger evidence.
// AUDITOR and ADMIN cannot — they have no operational write authority.
const requireOperatorOrEdge = requireRole("OPERATOR", "EDGE_INGEST");

/**
 * Hard server-side ceiling on ledger entry list queries.
 * Exported so automated tests can assert the cap is respected without
 * hard-coding the constant in multiple places.
 */
export const LEDGER_QUERY_MAX_LIMIT = 500;

// ─── Edge ingest Zod schema ───────────────────────────────────────────────────

/**
 * Request body for EDGE_INGEST submissions.
 *
 * Extends the standard ledger fields with:
 *   deviceId             — UUID assigned at device registration
 *   deviceSequenceNumber — monotonic counter maintained by the device for anti-replay
 *   deviceSignature      — Ed25519 signature over the canonical evidence payload
 *
 * The server resolves the device's public key from the registry.
 * NEVER supply a publicKey in the request body — it is always ignored.
 *
 * Canonical signed payload (stableJsonStringify with alphabetically sorted keys):
 *   { deviceId, deviceSequenceNumber, engineLoadPct, eventType, fuelMassKg,
 *     fuelType, positionLat, positionLon, timestampDevice, timestampGnss, vesselId }
 */
const EdgeIngestBody = z.object({
  vesselId: z.number().int().positive(),
  eventType: z.string().min(1),
  timestampGnss: z.string().datetime({ offset: true }),
  timestampDevice: z.string().datetime({ offset: true }).nullable().optional(),
  fuelType: z.string().min(1),
  fuelMassKg: z.number().positive(),
  engineLoadPct: z.number().min(0).max(100),
  positionLat: z.number().min(-90).max(90).nullable().optional(),
  positionLon: z.number().min(-180).max(180).nullable().optional(),
  isEstimated: z.boolean().optional(),
  // Edge-specific provenance fields
  deviceId: z.string().uuid("deviceId must be a UUID"),
  deviceSequenceNumber: z.number().int().min(0),
  /**
   * Ed25519 signature — 64 bytes as 128 lowercase hex chars.
   * Covers the canonical payload listed above.
   */
  deviceSignature: z
    .string()
    .regex(/^[0-9a-f]{128}$/i, "deviceSignature must be 128 hex chars (64-byte Ed25519 signature)"),
});

const router: IRouter = Router();

// ─── GET /ledger/entries ──────────────────────────────────────────────────────

router.get("/ledger/entries", async (req, res): Promise<void> => {
  const query = GetLedgerEntriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { vesselId, temporalTrust, limit } = query.data;
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
      keyId: ledgerEntriesTable.keyId,
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

// ─── POST /ledger/entries ─────────────────────────────────────────────────────

router.post(
  "/ledger/entries",
  requireOperatorOrEdge,
  writeLimiter,
  async (req, res): Promise<void> => {
    const role = req.auth!.role;

    // ── EDGE_INGEST path ────────────────────────────────────────────────────
    if (role === "EDGE_INGEST") {
      const parsed = EdgeIngestBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const data = parsed.data;

      // 1. Resolve device from registry
      const device = await getDeviceById(data.deviceId);
      if (!device) {
        res.status(422).json({
          error: "Unknown device: deviceId is not registered in the edge device registry",
        });
        return;
      }

      // 2. Enforce vessel binding — device is authorized for exactly one vessel
      if (device.vesselId !== data.vesselId) {
        res.status(422).json({
          error: `Device/vessel mismatch: device ${data.deviceId} is bound to vessel ${device.vesselId}, not ${data.vesselId}`,
        });
        return;
      }

      // 3. Enforce device status — revoked devices cannot submit new evidence
      if (device.status === "REVOKED") {
        res.status(422).json({
          error: "Device is REVOKED and cannot submit new evidence. Historical evidence remains preserved.",
        });
        return;
      }
      if (device.status !== "ACTIVE") {
        res.status(422).json({
          error: `Device is ${device.status} and cannot submit new evidence`,
        });
        return;
      }

      // 4. Verify device signature using server-side device public key
      // The authoritative public key comes from the registry — NEVER from the request body.
      const canonicalPayload = buildDeviceCanonicalPayload({
        deviceId: data.deviceId,
        vesselId: data.vesselId,
        eventType: data.eventType,
        timestampGnss: data.timestampGnss,
        timestampDevice: data.timestampDevice ?? null,
        fuelType: data.fuelType,
        fuelMassKg: data.fuelMassKg,
        engineLoadPct: data.engineLoadPct,
        positionLat: data.positionLat ?? null,
        positionLon: data.positionLon ?? null,
        deviceSequenceNumber: data.deviceSequenceNumber,
      });

      if (!verifyPayload(canonicalPayload, data.deviceSignature, device.publicKey)) {
        res.status(422).json({ error: "Invalid device signature: signature does not verify against the registered device public key" });
        return;
      }

      // 5. Anti-replay: reject sequence regression and duplicate sequences
      const maxSeq = await getMaxDeviceSequence(data.deviceId);
      if (maxSeq !== null && data.deviceSequenceNumber <= maxSeq) {
        res.status(409).json({
          error: `Replay rejected: sequence number ${data.deviceSequenceNumber} is not greater than the maximum accepted sequence ${maxSeq}`,
        });
        return;
      }

      // 6. Compute raw hash (does not depend on DB)
      const rawHash = computeRawHash({
        vesselId: data.vesselId,
        eventType: data.eventType,
        timestampGnss: data.timestampGnss,
        fuelType: data.fuelType,
        fuelMassKg: data.fuelMassKg,
        engineLoadPct: data.engineLoadPct,
      });

      // 7. Classify temporal trust
      const gnssTime = new Date(data.timestampGnss).getTime();
      const serverTime = Date.now();
      const diffMs = Math.abs(serverTime - gnssTime);
      const temporalTrust: "TRUSTED_GNSS" | "BACKFILL" | "DRIFT_WARNING" =
        diffMs > 24 * 60 * 60 * 1000
          ? "BACKFILL"
          : diffMs > 5 * 60 * 1000
            ? "DRIFT_WARNING"
            : "TRUSTED_GNSS";

      // 8. Server receipt signature — proves TRUSTION accepted and committed this evidence.
      // The server signs a payload that includes both the measurement data and the
      // source device identity, providing a TRUSTION-attested receipt.
      const serverSignPayload: Record<string, unknown> = {
        vesselId: data.vesselId,
        eventType: data.eventType,
        timestampGnss: data.timestampGnss,
        fuelType: data.fuelType,
        fuelMassKg: data.fuelMassKg,
        engineLoadPct: data.engineLoadPct,
        sourceDeviceId: data.deviceId,
        sourceKeyId: device.keyId,
        deviceSequenceNumber: data.deviceSequenceNumber,
      };
      const { signature, publicKey, keyId } = signPayload(serverSignPayload);

      // 9. Atomic transaction: epoch assignment + chain linkage + insert.
      // SELECT FOR UPDATE locks the OPEN epoch row so epoch closure and entry
      // assignment cannot interleave.  Caller cannot choose chainEpochId.
      try {
        const entry = await db.transaction(async (tx) => {
          const epochResult = await tx.execute(
            sql`SELECT epoch_id FROM chain_epochs WHERE vessel_id = ${data.vesselId} AND status = 'OPEN' FOR UPDATE LIMIT 1`,
          );
          const chainEpochId: string | null =
            (epochResult.rows[0] as { epoch_id?: string } | undefined)?.epoch_id ?? null;

          const [prev] = await tx
            .select({ chainHash: ledgerEntriesTable.chainHash })
            .from(ledgerEntriesTable)
            .orderBy(desc(ledgerEntriesTable.id))
            .limit(1);
          const prevHash = prev?.chainHash ?? null;
          const chainHash = computeChainHash(rawHash, prevHash);

          const [inserted] = await tx
            .insert(ledgerEntriesTable)
            .values({
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
              keyId,
              signerMode: "SOFTWARE_ED25519",
              isEstimated: data.isEstimated ?? false,
              temporalTrust,
              // Source provenance
              sourceDeviceId: data.deviceId,
              sourceKeyId: device.keyId,
              sourceSignature: data.deviceSignature,
              sourceSigningMode: "EDGE_ED25519",
              deviceSequenceNumber: data.deviceSequenceNumber,
              chainEpochId,
            })
            .returning();
          return inserted;
        });

        const [vessel] = await db
          .select({ name: vesselsTable.name })
          .from(vesselsTable)
          .where(eq(vesselsTable.id, entry.vesselId));

        res.status(201).json({
          ...entry,
          vesselName: vessel?.name ?? null,
          timestampGnss: entry.timestampGnss.toISOString(),
          timestampDevice: entry.timestampDevice?.toISOString() ?? null,
          timestampServer: entry.timestampServer?.toISOString() ?? null,
          createdAt: entry.createdAt.toISOString(),
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          res.status(409).json({
            error: "Duplicate sequence number: this sequence has already been accepted (possible concurrent replay)",
          });
          return;
        }
        throw err;
      }
      return;
    }

    // ── OPERATOR path (server-assigned chainEpochId) ────────────────────────
    const parsed = IngestLedgerEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const data = parsed.data;
    // Discard any caller-supplied signature or keyId — the server always computes its own.
    const { signature: _providedSignature, ...eventPayload } = data;
    const { signature, publicKey, keyId } = signPayload(eventPayload as Record<string, unknown>);

    const rawHash = computeRawHash({
      vesselId: data.vesselId,
      eventType: data.eventType,
      timestampGnss: data.timestampGnss,
      fuelType: data.fuelType,
      fuelMassKg: data.fuelMassKg,
      engineLoadPct: data.engineLoadPct,
    });

    const gnssTime = new Date(data.timestampGnss).getTime();
    const serverTime = Date.now();
    const diffMs = Math.abs(serverTime - gnssTime);
    let temporalTrust: "TRUSTED_GNSS" | "BACKFILL" | "DRIFT_WARNING" = "TRUSTED_GNSS";
    if (diffMs > 24 * 60 * 60 * 1000) temporalTrust = "BACKFILL";
    else if (diffMs > 5 * 60 * 1000) temporalTrust = "DRIFT_WARNING";

    // Atomic transaction: epoch assignment + chain linkage + insert.
    // Caller cannot choose chainEpochId — the server derives it from the
    // current OPEN epoch for this vessel (or null if no epoch is active).
    const entry = await db.transaction(async (tx) => {
      const epochResult = await tx.execute(
        sql`SELECT epoch_id FROM chain_epochs WHERE vessel_id = ${data.vesselId} AND status = 'OPEN' FOR UPDATE LIMIT 1`,
      );
      const chainEpochId: string | null =
        (epochResult.rows[0] as { epoch_id?: string } | undefined)?.epoch_id ?? null;

      const [prev] = await tx
        .select({ chainHash: ledgerEntriesTable.chainHash, id: ledgerEntriesTable.id })
        .from(ledgerEntriesTable)
        .orderBy(desc(ledgerEntriesTable.id))
        .limit(1);
      const prevHash = prev?.chainHash ?? null;
      const chainHash = computeChainHash(rawHash, prevHash);

      const [inserted] = await tx
        .insert(ledgerEntriesTable)
        .values({
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
          keyId,
          signerMode: "SOFTWARE_ED25519",
          isEstimated: data.isEstimated ?? false,
          temporalTrust,
          // OPERATOR submissions: no source device provenance
          sourceDeviceId: null,
          sourceKeyId: null,
          sourceSignature: null,
          sourceSigningMode: null,
          deviceSequenceNumber: null,
          chainEpochId,
        })
        .returning();
      return inserted;
    });

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
  },
);

// ─── GET /ledger/entries/:id ──────────────────────────────────────────────────

router.get("/ledger/entries/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

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
      keyId: ledgerEntriesTable.keyId,
      signerMode: ledgerEntriesTable.signerMode,
      isEstimated: ledgerEntriesTable.isEstimated,
      createdAt: ledgerEntriesTable.createdAt,
    })
    .from(ledgerEntriesTable)
    .leftJoin(vesselsTable, eq(ledgerEntriesTable.vesselId, vesselsTable.id))
    .where(eq(ledgerEntriesTable.id, id));

  if (!entry) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const allEntries = await db
    .select({ id: ledgerEntriesTable.id, chainHash: ledgerEntriesTable.chainHash })
    .from(ledgerEntriesTable)
    .orderBy(ledgerEntriesTable.id);
  const idx = allEntries.findIndex((e) => e.id === id);
  const merkleProof = buildMerkleProof(allEntries, idx);

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

// ─── GET /ledger/chain-status ─────────────────────────────────────────────────

router.get("/ledger/chain-status", chainStatusLimiter, async (_req, res): Promise<void> => {
  const entries = await db
    .select({
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
    })
    .from(ledgerEntriesTable)
    .orderBy(ledgerEntriesTable.id);

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
