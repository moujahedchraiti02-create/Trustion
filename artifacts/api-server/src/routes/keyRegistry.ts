/**
 * Signing Key Registry routes
 *
 * GET  /api/key-registry         — list all registry entries (public)
 * POST /api/key-registry/rotate  — rotate the active signing key (ADMIN only)
 * POST /api/key-registry/:keyId/retire  — retire a key (ADMIN only)
 * POST /api/key-registry/:keyId/revoke  — revoke a key with reason (ADMIN only)
 *
 * Private key material is NEVER stored in the registry or returned by these
 * routes.  The rotation endpoint accepts a new key hex ONLY to derive the
 * Ed25519 key pair; the hex is used in-process and discarded immediately.
 *
 * Authorization for rotation requires the ADMIN role.  Read access is public
 * to allow port authorities and flag state administrations to independently
 * verify key status without credentials.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  listKeys,
  getKeyById,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  rotateSigningKey,
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
    revocationReason: entry.revocationReason ?? null,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ─── GET /api/key-registry ────────────────────────────────────────────────────

router.get("/key-registry", (_req, res): void => {
  const entries = listKeys().map(serialiseEntry);
  res.json({
    activeKeyId: getActiveKeyId(),
    totalKeys: entries.length,
    entries,
  });
});

// ─── POST /api/key-registry/rotate ───────────────────────────────────────────

const RotateBody = z.object({
  /** 32-byte seed (64 hex chars) or 64-byte secret key (128 hex chars). */
  newKeyHex: z.string().min(64).max(128).regex(/^[0-9a-fA-F]+$/, "Must be hexadecimal"),
});

router.post("/key-registry/rotate", requireAdmin, writeLimiter, (req, res): void => {
  const parsed = RotateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const newKeyId = rotateSigningKey(parsed.data.newKeyHex);
    const entry = getKeyById(newKeyId);
    res.status(200).json({
      message: "Signing key rotated successfully.",
      newKeyId,
      entry: serialiseEntry(entry),
      warning:
        "This rotation is in-memory only. Update ED25519_SECRET_KEY_HEX in the " +
        "deployment environment before the next server restart to make it permanent.",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── POST /api/key-registry/:keyId/retire ────────────────────────────────────

router.post("/key-registry/:keyId/retire", requireAdmin, writeLimiter, (req, res): void => {
  const keyId = String(req.params.keyId);
  const entry = getKeyById(keyId);
  if (!entry) {
    res.status(404).json({ error: `Key not found: ${keyId}` });
    return;
  }
  if (entry.status === "REVOKED") {
    res.status(409).json({
      error: "Key is REVOKED. Retirement is a softer status — a revoked key cannot be demoted to retired.",
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
        "Cannot retire the currently active signing key directly. " +
        "Use /rotate to rotate to a new key (which automatically retires this one).",
    });
    return;
  }

  try {
    retireKeyInRegistry(keyId);
    res.json({ message: "Key retired.", entry: serialiseEntry(getKeyById(keyId)) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── POST /api/key-registry/:keyId/revoke ────────────────────────────────────

const RevokeBody = z.object({
  reason: z.string().min(1, "Revocation reason is required"),
});

router.post("/key-registry/:keyId/revoke", requireAdmin, writeLimiter, (req, res): void => {
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
    res.status(409).json({ error: "Key is already REVOKED.", entry: serialiseEntry(entry) });
    return;
  }

  try {
    // If revoking the active key, use revokeCurrentSigningKey so _activeKeyId is cleared.
    if (keyId === getActiveKeyId()) {
      revokeCurrentSigningKey(parsed.data.reason);
    } else {
      revokeKeyInRegistry(keyId, parsed.data.reason);
    }
    res.json({
      message: "Key revoked. Historical records signed with this key are preserved.",
      entry: serialiseEntry(getKeyById(keyId)),
      warning:
        keyId === getActiveKeyId()
          ? undefined
          : "The server is now unable to sign new evidence. " +
            "Rotate in a replacement key immediately.",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
