/**
 * Signing Key Registry routes
 *
 * GET  /api/key-registry          — list all registry entries (public)
 * GET  /api/key-registry/events   — list append-only lifecycle events (public)
 * POST /api/key-registry/:keyId/retire  — retire a non-active key (ADMIN only)
 * POST /api/key-registry/:keyId/revoke  — revoke a key with reason (ADMIN only)
 *
 * IMPORTANT — no private key material
 * ────────────────────────────────────
 * None of these endpoints accepts or returns private key material.
 * There is NO rotation endpoint.  Key rotation is a deployment operation:
 *   1. Generate a new Ed25519 seed offline.
 *   2. Update the ED25519_SECRET_KEY_HEX deployment secret.
 *   3. Restart the server.
 * On startup, initRegistryAndActivate() atomically retires the previous
 * ACTIVE key and activates the new one before the server begins accepting
 * requests.
 *
 * Authorization
 * ─────────────
 * Read endpoints are public so port authorities and flag state administrations
 * can independently verify key status and lifecycle history without credentials.
 * Write endpoints (retire, revoke) require the ADMIN role.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  listKeys,
  listKeyEvents,
  getKeyById,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  revokeCurrentSigningKey,
  getActiveKeyId,
} from "../lib/crypto.js";
import { requireRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rateLimiter.js";

const router: IRouter = Router();

const requireAdmin = requireRole("ADMIN");

// ─── Serialise a registry entry (public-safe — no private key material) ───────

function serialiseEntry(entry: ReturnType<typeof getKeyById>) {
  if (!entry) return null;
  return {
    keyId: entry.keyId,
    publicKey: entry.publicKey,
    fingerprint: entry.fingerprint,
    algorithm: entry.algorithm,
    signingMode: entry.signingMode,
    status: entry.status,
    activatedAt: entry.activatedAt.toISOString(),
    retiredAt: entry.retiredAt?.toISOString() ?? null,
    revokedAt: entry.revokedAt?.toISOString() ?? null,
    revocationReason: entry.revocationReason ?? null,
    expiresAt: entry.expiresAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ─── GET /api/key-registry ────────────────────────────────────────────────────

router.get("/key-registry", (_req, res): void => {
  const entries = listKeys().map(serialiseEntry);
  res.json({
    /**
     * Rotation note: This endpoint reflects the in-process view of the
     * registry.  The source of truth for offline forensic verification is
     * GET /api/key-registry/events, which returns the full append-only
     * lifecycle event log.
     */
    activeKeyId: getActiveKeyId(),
    totalKeys: entries.length,
    entries,
  });
});

// ─── GET /api/key-registry/events ────────────────────────────────────────────

/**
 * Returns the complete append-only signing key lifecycle event log.
 * Use this for offline forensic verification and TRUSTION evidence packaging.
 *
 * Optional query param: keyId — filter to a specific signing key.
 */
router.get("/key-registry/events", async (req, res): Promise<void> => {
  const keyId = typeof req.query.keyId === "string" ? req.query.keyId : undefined;
  try {
    const events = await listKeyEvents(keyId);
    res.json({
      totalEvents: events.length,
      events: events.map((e) => ({
        id: e.id,
        keyId: e.keyId,
        eventType: e.eventType,
        effectiveAt: e.effectiveAt.toISOString(),
        actor: e.actor,
        reason: e.reason ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load key events." });
    return;
  }
});

// ─── POST /api/key-registry/:keyId/retire ────────────────────────────────────

const RetireBody = z.object({
  reason: z.string().min(1).optional(),
});

router.post(
  "/key-registry/:keyId/retire",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const keyId = String(req.params.keyId);
    const parsed = RetireBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const entry = getKeyById(keyId);
    if (!entry) {
      res.status(404).json({ error: `Key not found: ${keyId}` });
      return;
    }
    if (entry.status === "REVOKED") {
      res.status(409).json({
        error:
          "Key is REVOKED. Revocation is a stronger status — a revoked key cannot be demoted to retired.",
      });
      return;
    }
    if (entry.status === "RETIRED") {
      res.status(409).json({ error: "Key is already RETIRED." });
      return;
    }
    if (keyId === getActiveKeyId()) {
      res.status(409).json({
        error:
          "Cannot retire the currently ACTIVE signing key via this endpoint. " +
          "To rotate cleanly: update ED25519_SECRET_KEY_HEX and restart. " +
          "For an emergency stop: use POST /api/key-registry/:keyId/revoke.",
      });
      return;
    }

    const actor = req.auth!.subject;
    try {
      await retireKeyInRegistry(keyId, actor, parsed.data.reason);
      res.json({
        message: "Key retired successfully.",
        entry: serialiseEntry(getKeyById(keyId)),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },
);

// ─── POST /api/key-registry/:keyId/revoke ────────────────────────────────────

const RevokeBody = z.object({
  reason: z.string().min(1, "Revocation reason is required"),
});

router.post(
  "/key-registry/:keyId/revoke",
  requireAdmin,
  writeLimiter,
  async (req, res): Promise<void> => {
    const keyId = String(req.params.keyId);
    const parsed = RevokeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const entry = getKeyById(keyId);
    if (!entry) {
      res.status(404).json({ error: `Key not found: ${keyId}` });
      return;
    }
    if (entry.status === "REVOKED") {
      res.status(409).json({
        error: "Key is already REVOKED.",
        entry: serialiseEntry(entry),
      });
      return;
    }

    const actor = req.auth!.subject;
    try {
      if (keyId === getActiveKeyId()) {
        // Revoke the currently ACTIVE key — clears _activeKeyId in crypto.ts.
        await revokeCurrentSigningKey(parsed.data.reason, actor);
      } else {
        await revokeKeyInRegistry(keyId, parsed.data.reason, actor);
      }
      res.json({
        message:
          keyId === getActiveKeyId()
            ? "Active signing key revoked. Server cannot sign new evidence. " +
              "Update ED25519_SECRET_KEY_HEX and restart to restore signing capability."
            : "Key revoked. Historical records signed with this key are preserved.",
        entry: serialiseEntry(getKeyById(keyId)),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  },
);

export default router;
