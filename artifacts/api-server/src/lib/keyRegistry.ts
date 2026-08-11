/**
 * In-process signing key registry with async DB persistence.
 *
 * Architecture
 * ────────────
 * An in-memory Map<keyId, KeyRegistryEntry> is the authoritative source for
 * the running process.  Every mutation is also written to the database
 * asynchronously so the full key history survives server restarts.
 *
 * Key ID
 * ──────
 * key_id = SHA-256(publicKeyBytes) expressed as 64 lowercase hex characters.
 * It is stable, deterministic, and globally unique per key pair.  It is NOT
 * the same as the fingerprint, which is only the first 16 hex characters
 * (8 bytes) of the same hash.
 *
 * Status model
 * ────────────
 *   ACTIVE  → the key is currently used to create new evidence signatures.
 *             At most one key per signing purpose may be ACTIVE at a time.
 *   RETIRED → the key is no longer used for signing but remains valid for
 *             historical verification.  Retirement does NOT invalidate past
 *             signatures — it only prevents future signing under that key.
 *   REVOKED → the key is suspected or confirmed compromised.  The registry
 *             record and revocation_reason are preserved permanently.
 *             Historical records signed with a REVOKED key remain in the
 *             database; auditors are expected to evaluate them case-by-case.
 *             Revocation does NOT automatically delete or alter those records.
 *
 * Tamper evidence
 * ───────────────
 * Registry rows are INSERT-only for new keys.  Status transitions (RETIRE /
 * REVOKE) are UPDATE operations on existing rows — they record the transition
 * timestamp and reason rather than deleting history.  No row is ever deleted.
 *
 * Limitations
 * ───────────
 * • No TPM/HSM backing — private key material lives in process memory.
 * • No automated rotation — manual rotation via the /api/key-registry/rotate
 *   endpoint or by updating ED25519_SECRET_KEY_HEX and restarting.
 * • No cross-instance registry sync beyond the shared database.
 */

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db, signingKeyRegistryTable } from "@workspace/db";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KeyStatus = "ACTIVE" | "RETIRED" | "REVOKED";

export interface KeyRegistryEntry {
  /** SHA-256(publicKey bytes) as 64 lowercase hex chars. */
  keyId: string;
  /** Hex-encoded Ed25519 public key (32 bytes = 64 hex chars). Safe to expose. */
  publicKey: string;
  /** First 16 hex chars of keyId. Safe to log. */
  fingerprint: string;
  algorithm: "Ed25519";
  signingMode: string;
  status: KeyStatus;
  activatedAt: Date;
  retiredAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
}

// ─── In-memory registry ───────────────────────────────────────────────────────

const registryMap = new Map<string, KeyRegistryEntry>();

// ─── Key ID derivation ────────────────────────────────────────────────────────

/**
 * Derive a stable, unique key identifier from a public key.
 *
 * Returns SHA-256(publicKey bytes) as a 64-character lowercase hex string.
 * This is deterministic: the same public key always produces the same key_id.
 * It is NOT the fingerprint — fingerprint is the first 16 chars of this hash.
 */
export function computeKeyId(publicKeyHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest("hex"); // 64 hex chars
}

// ─── Registry read operations (synchronous) ───────────────────────────────────

export function getKeyById(keyId: string): KeyRegistryEntry | null {
  return registryMap.get(keyId) ?? null;
}

export function getActiveKey(): KeyRegistryEntry | null {
  for (const entry of registryMap.values()) {
    if (entry.status === "ACTIVE") return entry;
  }
  return null;
}

export function listKeys(): KeyRegistryEntry[] {
  return Array.from(registryMap.values()).sort(
    (a, b) => a.activatedAt.getTime() - b.activatedAt.getTime(),
  );
}

// ─── Registry write operations (sync Map + async DB) ─────────────────────────

/**
 * Register a key as ACTIVE.
 *
 * - Idempotent: if the key is already registered with ACTIVE status, returns
 *   its existing key_id without modification.
 * - Rotation: any other key currently ACTIVE is automatically retired before
 *   the new key is activated.
 * - Re-activation: a RETIRED key can be re-registered as ACTIVE (rollback
 *   scenario), but a REVOKED key cannot.
 *
 * Returns the key_id of the registered/activated key.
 */
export function registerKey(
  publicKeyHex: string,
  fingerprint: string,
  signingMode: string,
  activatedAt: Date = new Date(),
): string {
  const keyId = computeKeyId(publicKeyHex);

  // Already ACTIVE — idempotent, nothing to do.
  const existing = registryMap.get(keyId);
  if (existing?.status === "ACTIVE") {
    return keyId;
  }

  // REVOKED keys cannot be re-activated.
  if (existing?.status === "REVOKED") {
    throw new Error(
      `Key ${keyId} is REVOKED and cannot be re-activated. ` +
        "A revoked key must remain revoked; generate a new key pair instead.",
    );
  }

  // Retire any other ACTIVE key before activating this one.
  for (const [id, entry] of registryMap) {
    if (entry.status === "ACTIVE" && id !== keyId) {
      _retireKeySync(id, activatedAt);
    }
  }

  if (existing?.status === "RETIRED") {
    // Re-activate a previously retired key (rollback scenario).
    const reactivated: KeyRegistryEntry = {
      ...existing,
      status: "ACTIVE",
      activatedAt,
      retiredAt: null,
    };
    registryMap.set(keyId, reactivated);
    _persistUpdateAsync(keyId, { status: "ACTIVE", retiredAt: null as unknown as Date });
  } else {
    // New key registration.
    const entry: KeyRegistryEntry = {
      keyId,
      publicKey: publicKeyHex,
      fingerprint,
      algorithm: "Ed25519",
      signingMode,
      status: "ACTIVE",
      activatedAt,
      retiredAt: null,
      revocationReason: null,
      createdAt: new Date(),
    };
    registryMap.set(keyId, entry);
    _persistInsertAsync(entry);
  }

  return keyId;
}

/**
 * Retire a key: marks it RETIRED so it can no longer be used for new
 * signatures while remaining valid for historical signature verification.
 *
 * Idempotent if the key is already RETIRED.
 * Throws if the key is REVOKED (revocation is a stronger status).
 */
export function retireKeyInRegistry(keyId: string, retiredAt: Date = new Date()): void {
  const entry = registryMap.get(keyId);
  if (!entry) throw new Error(`Key not found in registry: ${keyId}`);
  if (entry.status === "REVOKED") {
    throw new Error(
      `Key ${keyId} is already REVOKED. Retirement is a softer status — ` +
        "a revoked key cannot be demoted to merely retired.",
    );
  }
  if (entry.status === "RETIRED") return; // idempotent

  _retireKeySync(keyId, retiredAt);
}

/**
 * Revoke a key: marks it REVOKED with a mandatory reason.
 * Revocation preserves the full historical record — the key entry and all
 * evidence signed under it remain in the database.
 *
 * Idempotent (preserves the FIRST revocation reason if called again).
 */
export function revokeKeyInRegistry(keyId: string, reason: string): void {
  const entry = registryMap.get(keyId);
  if (!entry) throw new Error(`Key not found in registry: ${keyId}`);
  if (entry.status === "REVOKED") return; // idempotent — preserve first reason

  const now = new Date();
  const updated: KeyRegistryEntry = {
    ...entry,
    status: "REVOKED",
    retiredAt: now,
    revocationReason: reason,
  };
  registryMap.set(keyId, updated);
  _persistUpdateAsync(keyId, {
    status: "REVOKED",
    retiredAt: now,
    revocationReason: reason,
  });
}

// ─── DB initialisation (async) ────────────────────────────────────────────────

/**
 * Populate the in-memory registry from the database.
 *
 * Call once at server startup AFTER the database is available.  Keys already
 * present in the in-memory map (registered at module load from the current env
 * key) are NOT overwritten — the process-local view of the active key takes
 * precedence over what the database says.
 */
export async function initRegistry(): Promise<void> {
  try {
    const rows = await db.select().from(signingKeyRegistryTable);
    for (const row of rows) {
      if (!registryMap.has(row.keyId)) {
        registryMap.set(row.keyId, {
          keyId: row.keyId,
          publicKey: row.publicKey,
          fingerprint: row.fingerprint,
          algorithm: "Ed25519",
          signingMode: row.signingMode,
          status: row.status as KeyStatus,
          activatedAt: row.activatedAt,
          retiredAt: row.retiredAt ?? null,
          revocationReason: row.revocationReason ?? null,
          createdAt: row.createdAt,
        });
      }
    }
    logger.info(
      { registrySize: registryMap.size },
      "Signing key registry loaded from database.",
    );
  } catch (err) {
    logger.error(
      { err },
      "Failed to load signing key registry from database. " +
        "Historical key lookup will be limited to keys seen this session.",
    );
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Clear all in-memory registry entries. For test isolation ONLY. */
export function _clearRegistryForTesting(): void {
  registryMap.clear();
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _retireKeySync(keyId: string, retiredAt: Date): void {
  const entry = registryMap.get(keyId);
  if (!entry) return;
  const updated: KeyRegistryEntry = { ...entry, status: "RETIRED", retiredAt };
  registryMap.set(keyId, updated);
  _persistUpdateAsync(keyId, { status: "RETIRED", retiredAt });
}

// ─── Async DB persistence (fire-and-forget, errors logged not thrown) ─────────

async function _persistInsertAsync(entry: KeyRegistryEntry): Promise<void> {
  try {
    await db
      .insert(signingKeyRegistryTable)
      .values({
        keyId: entry.keyId,
        publicKey: entry.publicKey,
        fingerprint: entry.fingerprint,
        algorithm: entry.algorithm,
        signingMode: entry.signingMode,
        status: entry.status,
        activatedAt: entry.activatedAt,
        retiredAt: entry.retiredAt ?? undefined,
        revocationReason: entry.revocationReason ?? undefined,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.error({ err, keyId: entry.keyId }, "Failed to persist signing key to database.");
  }
}

async function _persistUpdateAsync(
  keyId: string,
  patch: Partial<{
    status: "ACTIVE" | "RETIRED" | "REVOKED";
    retiredAt: Date | null;
    revocationReason: string;
  }>,
): Promise<void> {
  try {
    await db
      .update(signingKeyRegistryTable)
      .set(patch)
      .where(eq(signingKeyRegistryTable.keyId, keyId));
  } catch (err) {
    logger.error({ err, keyId }, "Failed to update signing key status in database.");
  }
}
