/**
 * Edge device registry — S³V TRUSTION
 *
 * ADMIN manages the device registry (register, retire, revoke).
 * ADMIN and AUDITOR may list and inspect devices.
 * EDGE_INGEST callers never interact with this endpoint — they submit
 * evidence via POST /api/ledger/entries with their deviceId.
 *
 * Private key material is NEVER accepted through any endpoint in this router.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimiter.js";
import {
  registerDevice,
  getDeviceById,
  listDevices,
  retireDevice,
  revokeDevice,
} from "../lib/edgeDevice.js";

const router: IRouter = Router();

const requireAdmin = requireRole("ADMIN");
const requireAdminOrAuditor = requireRole("ADMIN", "AUDITOR");

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const RegisterDeviceBody = z.object({
  vesselId: z.number().int().positive(),
  /**
   * Ed25519 public key — 32 bytes expressed as 64 lowercase hex chars.
   * The corresponding private key must NEVER be transmitted to this server.
   */
  publicKey: z
    .string()
    .regex(
      /^[0-9a-f]{64}$/,
      "publicKey must be exactly 64 lowercase hex chars (32-byte Ed25519 public key)",
    ),
  label: z.string().min(1).max(200),
});

const RevokeDeviceBody = z.object({
  reason: z.string().min(1).max(500),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/** List all registered edge devices. */
router.get("/devices", requireAdminOrAuditor, async (_req, res): Promise<void> => {
  const devices = await listDevices();
  res.json(
    devices.map((d) => ({
      ...d,
      activatedAt: d.activatedAt.toISOString(),
      retiredAt: d.retiredAt?.toISOString() ?? null,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  );
});

/**
 * Register a new edge device.
 *
 * Accepts the device public key and vessel binding.
 * Private key material is NEVER accepted here.
 * Returns the server-assigned deviceId.
 */
router.post("/devices", requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterDeviceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const deviceId = await registerDevice(parsed.data);
    const device = await getDeviceById(deviceId);
    res.status(201).json({
      ...device,
      activatedAt: device!.activatedAt.toISOString(),
      retiredAt: null,
      revokedAt: null,
      createdAt: device!.createdAt.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Unique constraint violations (duplicate publicKey or keyId)
    if (msg.includes("unique") || (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505")) {
      res.status(409).json({ error: "A device with this public key is already registered" });
      return;
    }
    throw err;
  }
});

/** Get a single device by deviceId. */
router.get("/devices/:deviceId", requireAdminOrAuditor, async (req, res): Promise<void> => {
  const deviceId = req.params.deviceId as string;
  const device = await getDeviceById(deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  res.json({
    ...device,
    activatedAt: device.activatedAt.toISOString(),
    retiredAt: device.retiredAt?.toISOString() ?? null,
    revokedAt: device.revokedAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  });
});

/**
 * Retire a device (planned decommission).
 * The device's historical evidence remains verifiable.
 */
router.post(
  "/devices/:deviceId/retire",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const deviceId = req.params.deviceId as string;
    try {
      await retireDevice(deviceId, req.auth!.subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg.includes("only ACTIVE")) {
        res.status(409).json({ error: msg });
        return;
      }
      throw err;
    }
    const device = await getDeviceById(deviceId);
    res.json({
      ...device,
      activatedAt: device!.activatedAt.toISOString(),
      retiredAt: device!.retiredAt?.toISOString() ?? null,
      revokedAt: device!.revokedAt?.toISOString() ?? null,
      createdAt: device!.createdAt.toISOString(),
    });
  },
);

/**
 * Revoke a device (security event / compromise).
 *
 * revokedAt is distinct from retiredAt.  Evidence signed before revokedAt
 * remains historically valid; evidence attributed after revokedAt is flagged
 * as suspicious by the auditor endpoint.
 */
router.post(
  "/devices/:deviceId/revoke",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const deviceId = req.params.deviceId as string;
    const parsed = RevokeDeviceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await revokeDevice(deviceId, parsed.data.reason, req.auth!.subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg.includes("already REVOKED")) {
        res.status(409).json({ error: msg });
        return;
      }
      throw err;
    }
    const device = await getDeviceById(deviceId);
    res.json({
      ...device,
      activatedAt: device!.activatedAt.toISOString(),
      retiredAt: device!.retiredAt?.toISOString() ?? null,
      revokedAt: device!.revokedAt?.toISOString() ?? null,
      createdAt: device!.createdAt.toISOString(),
    });
  },
);

export default router;
