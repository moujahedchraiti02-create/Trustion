/**
 * Chain Epoch routes — Task #12
 *
 * POST /chain-epochs/open             ADMIN only
 * POST /chain-epochs/:epochId/close   ADMIN only
 * GET  /chain-epochs                  ADMIN | AUDITOR  (requires ?vesselId=)
 * GET  /chain-epochs/:epochId         ADMIN | AUDITOR
 * GET  /chain-epochs/:epochId/verify  ADMIN | AUDITOR
 * GET  /chain-epochs/:epochId/proof/:ledgerEntryId  ADMIN | AUDITOR
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { readLimiter, writeLimiter } from "../middleware/rateLimiter.js";
import {
  openEpoch,
  closeEpoch,
  getEpochsByVessel,
  getEpochById,
  verifyEpoch,
  getInclusionProof,
  type ChainEpoch,
} from "../lib/epochService.js";

const router: IRouter = Router();

const requireAdmin = requireRole("ADMIN");
const requireAdminOrAuditor = requireRole("ADMIN", "AUDITOR");

// ─── POST /chain-epochs/open ──────────────────────────────────────────────────

const OpenEpochBody = z.object({
  vesselId: z.number().int().positive(),
  algorithm: z.string().min(1).default("SHA-256"),
  canonicalizationVersion: z.string().min(1).default("v1"),
});

router.post(
  "/chain-epochs/open",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const parsed = OpenEpochBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { vesselId, algorithm, canonicalizationVersion } = parsed.data;
    try {
      const epoch = await openEpoch(
        vesselId,
        algorithm,
        canonicalizationVersion,
        req.auth!.subject,
      );
      res.status(201).json(serializeEpoch(epoch));
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "EPOCH_ALREADY_OPEN") {
        res.status(409).json({ error: e.message });
      } else if (e.code === "UNSUPPORTED_ALGORITHM" || e.code === "UNSUPPORTED_VERSION") {
        res.status(400).json({ error: e.message });
      } else {
        throw err;
      }
    }
  },
);

// ─── POST /chain-epochs/:epochId/close ───────────────────────────────────────

router.post(
  "/chain-epochs/:epochId/close",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const epochId = req.params.epochId as string;
    try {
      const epoch = await closeEpoch(epochId, req.auth!.subject);
      res.json(serializeEpoch(epoch));
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "EPOCH_NOT_FOUND") {
        res.status(404).json({ error: e.message });
      } else if (
        e.code === "EPOCH_ALREADY_CLOSED" ||
        e.code === "EPOCH_CONCURRENT_CLOSE"
      ) {
        res.status(409).json({ error: e.message });
      } else if (
        e.code === "EPOCH_EMPTY" ||
        e.code === "EPOCH_INVALID_LEAF" ||
        e.code === "EPOCH_HASH_TAMPERED" ||
        e.code === "EPOCH_CHAIN_BROKEN"
      ) {
        res.status(422).json({ error: e.message });
      } else {
        throw err;
      }
    }
  },
);

// ─── GET /chain-epochs ────────────────────────────────────────────────────────

const EpochsQuery = z.object({
  vesselId: z
    .string()
    .transform((v) => parseInt(v, 10))
    .refine((v) => !isNaN(v) && v > 0, "vesselId must be a positive integer"),
});

router.get(
  "/chain-epochs",
  requireAdminOrAuditor,
  readLimiter,
  async (req, res): Promise<void> => {
    const parsed = EpochsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "vesselId query parameter is required and must be a positive integer" });
      return;
    }
    const epochs = await getEpochsByVessel(parsed.data.vesselId);
    res.json({ epochs: epochs.map(serializeEpoch) });
  },
);

// ─── GET /chain-epochs/:epochId ───────────────────────────────────────────────

router.get(
  "/chain-epochs/:epochId",
  requireAdminOrAuditor,
  readLimiter,
  async (req, res): Promise<void> => {
    const epochId = req.params.epochId as string;
    const epoch = await getEpochById(epochId);
    if (!epoch) {
      res.status(404).json({ error: `Epoch ${epochId} not found` });
      return;
    }
    res.json(serializeEpoch(epoch));
  },
);

// ─── GET /chain-epochs/:epochId/verify ───────────────────────────────────────

router.get(
  "/chain-epochs/:epochId/verify",
  requireAdminOrAuditor,
  readLimiter,
  async (req, res): Promise<void> => {
    const epochId = req.params.epochId as string;
    try {
      const result = await verifyEpoch(epochId);
      res.json(result);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "EPOCH_NOT_FOUND") {
        res.status(404).json({ error: e.message });
      } else {
        throw err;
      }
    }
  },
);

// ─── GET /chain-epochs/:epochId/proof/:ledgerEntryId ─────────────────────────

router.get(
  "/chain-epochs/:epochId/proof/:ledgerEntryId",
  requireAdminOrAuditor,
  readLimiter,
  async (req, res): Promise<void> => {
    const epochId = req.params.epochId as string;
    const raw = Array.isArray(req.params.ledgerEntryId)
      ? req.params.ledgerEntryId[0]
      : req.params.ledgerEntryId;
    const ledgerEntryId = parseInt(raw, 10);
    if (isNaN(ledgerEntryId)) {
      res.status(400).json({ error: "ledgerEntryId must be an integer" });
      return;
    }
    try {
      const proof = await getInclusionProof(epochId, ledgerEntryId);
      res.json(proof);
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "EPOCH_NOT_FOUND" || e.code === "ENTRY_NOT_IN_EPOCH") {
        res.status(404).json({ error: e.message });
      } else if (e.code === "EPOCH_NOT_CLOSED" || e.code === "EPOCH_NO_ROOT") {
        res.status(409).json({ error: e.message });
      } else {
        throw err;
      }
    }
  },
);

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializeEpoch(epoch: ChainEpoch) {
  return {
    ...epoch,
    openedAt: epoch.openedAt.toISOString(),
    closedAt: epoch.closedAt?.toISOString() ?? null,
    createdAt: epoch.createdAt.toISOString(),
  };
}

export default router;
