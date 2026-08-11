/**
 * Signing key registry — transactional persistence + in-memory read cache.
 *
 * Architectural guarantees
 * ─────────────────────────
 * 1. A key does not become ACTIVE in memory until its registry row AND the
 *    KEY_ACTIVATED event row have been durably committed to the database.
 *    Persistence failures fail closed (throw, never silently continue).
 *
 * 2. At most ONE key may have status = 'ACTIVE' at any time, enforced by:
 *    • A partial unique index on signing_key_registry WHERE status = 'ACTIVE',
 *      applied idempotently at startup.
 *    • A DB transaction that retires the old key before activating the new one,
 *      so two concurrent startups cannot both see "no active key" and both
 *      insert ACTIVE rows — one will block on the UPDATE of the existing row,
 *      then see the partial index conflict on insert.
 *
 * 3. Every lifecycle transition (ACTIVATE / RETIRE / REVOKE) appends a row
 *    to signing_key_events.  The in-memory status field is a fast-read cache;
 *    signing_key_events is the forensic ground truth.
 *
 * 4. Private key material is never stored, logged, or returned.
 *
 * 5. Activation is the only path into ACTIVE status, and it only runs at
 *    server startup (or test isolation helpers).  The API never receives
 *    private key material — rotation is: update ED25519_SECRET_KEY_HEX →
 *    restart → startup atomically activates the new key.
 *
 * Rotation workflow (zero-downtime limitation)
 * ─────────────────────────────────────────────
 * This prototype does not support zero-downtime key rotation.  Rotation
 * requires:
 *   1. Generate a new Ed25519 seed offline.
 *   2. Update the ED25519_SECRET_KEY_HEX deployment secret.
 *   3. Restart the server.
 *   4. On startup, initRegistryAndActivate() detects the new key, atomically
 *      retires the previous ACTIVE key, activates the new one, and appends
 *      KEY_RETIRED + KEY_ACTIVATED events before the server begins accepting
 *      requests.
 * No API endpoint ever accepts or touches private key material.
 */

import { createHash } from "crypto";
import { and, eq, ne, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, signingKeyRegistryTable, signingKeyEventsTable } from "@workspace/db";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type KeyStatus = "ACTIVE" | "RETIRED" | "REVOKED";
export type KeyEventType = "KEY_ACTIVATED" | "KEY_RETIRED" | "KEY_REVOKED";

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
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
}

export interface KeyEvent {
  id: number;
  keyId: string;
  eventType: KeyEventType;
  effectiveAt: Date;
  actor: string;
  reason: string | null;
  createdAt: Date;
}

export interface SignatureContext {
  /** Whether the cryptographic signature is valid. */
  valid: boolean;
  /** Status of the signing key at query time. 'UNKNOWN' if keyId not in registry. */
  keyStatus: KeyStatus | "UNKNOWN";
  /** When the key was revoked, or null if not revoked. */
  revokedAt: Date | null;
  /**
   * When signatureTimestamp is provided and the key is REVOKED:
   * true  → signature timestamp predates revocation (historically legitimate).
   * false → signature timestamp is on or after revocation (suspicious).
   * null  → key not revoked, or no signatureTimestamp provided.
   */
  signedBeforeRevocation: boolean | null;
}

// ─── In-memory registry ───────────────────────────────────────────────────────

const registryMap = new Map<string, KeyRegistryEntry>();

// ─── Key ID derivation ────────────────────────────────────────────────────────

/**
 * Derive a stable, unique key identifier from a public key.
 * Returns SHA-256(publicKey bytes) as 64 lowercase hex chars.
 */
export function computeKeyId(publicKeyHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest("hex");
}

// ─── Synchronous read operations ──────────────────────────────────────────────

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

/**
 * Rich verification context for a signature.  Used by auditors to determine
 * whether a historically-valid signature was created before or after a key
 * was revoked.  signatureTimestamp should be the ledger entry's timestampGnss.
 */
export function checkSignatureContext(
  payload: Record<string, unknown>,
  signatureHex: string,
  keyId: string,
  verifyFn: (payload: Record<string, unknown>, sig: string, pubKey: string) => boolean,
  signatureTimestamp?: Date,
): SignatureContext {
  const entry = getKeyById(keyId);
  if (!entry || !entry.publicKey || entry.publicKey.length !== 64) {
    return { valid: false, keyStatus: "UNKNOWN", revokedAt: null, signedBeforeRevocation: null };
  }

  const valid = verifyFn(payload, signatureHex, entry.publicKey);
  const revokedAt = entry.revokedAt ?? null;

  let signedBeforeRevocation: boolean | null = null;
  if (revokedAt !== null && signatureTimestamp !== undefined) {
    signedBeforeRevocation = signatureTimestamp.getTime() < revokedAt.getTime();
  }

  return { valid, keyStatus: entry.status, revokedAt, signedBeforeRevocation };
}

// ─── Async event log read ─────────────────────────────────────────────────────

export async function listKeyEvents(keyId?: string): Promise<KeyEvent[]> {
  const rows = keyId
    ? await db
        .select()
        .from(signingKeyEventsTable)
        .where(eq(signingKeyEventsTable.keyId, keyId))
        .orderBy(desc(signingKeyEventsTable.createdAt))
    : await db
        .select()
        .from(signingKeyEventsTable)
        .orderBy(desc(signingKeyEventsTable.createdAt));

  return rows.map((r) => ({
    id: r.id,
    keyId: r.keyId,
    eventType: r.eventType as KeyEventType,
    effectiveAt: r.effectiveAt,
    actor: r.actor,
    reason: r.reason ?? null,
    createdAt: r.createdAt,
  }));
}

// ─── Startup activation (transactional, fail-closed) ─────────────────────────

/**
 * Atomically register and activate a signing key.  This is the ONLY path
 * into ACTIVE status.  Must be called (and awaited) before the HTTP server
 * begins accepting requests.
 *
 * Steps (single DB transaction):
 *   1. Ensure the partial unique index exists (idempotent DDL).
 *   2. Lock all currently ACTIVE keys FOR UPDATE.
 *   3. If the env key is already ACTIVE → idempotent (return keyId, emit
 *      KEY_ACTIVATED event only if none exists yet).
 *   4. If the env key is REVOKED in the registry → fail closed; the private
 *      key has been declared compromised and must not be re-activated.
 *   5. Retire any other ACTIVE key (UPDATE status + KEY_RETIRED event).
 *   6. Activate the new key (INSERT or UPDATE) + KEY_ACTIVATED event.
 *   7. On commit, hydrate the in-memory map from the DB.
 *
 * Throws on any DB error or security invariant violation.  The caller
 * (src/index.ts) must catch and call process.exit(1) on failure.
 */
export async function initRegistryAndActivate(
  publicKeyHex: string,
  fingerprint: string,
  signingMode: string,
  actor: string = "system:startup",
): Promise<string> {
  const keyId = computeKeyId(publicKeyHex);
  const now = new Date();

  // Ensure the partial unique index exists.  Idempotent — safe to run every
  // startup.  This is the DB-level guard against concurrent activation.
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS one_active_signing_key_idx
        ON signing_key_registry ((1)) WHERE status = 'ACTIVE'`,
  );

  await db.transaction(async (tx) => {
    // Lock any ACTIVE row(s) to serialise concurrent startups.
    const activeRows = await tx.execute(
      sql`SELECT key_id, status FROM signing_key_registry WHERE status = 'ACTIVE' FOR UPDATE`,
    );

    const activeRow = activeRows.rows[0] as { key_id: string } | undefined;
    const currentActiveKeyId: string | undefined = activeRow?.key_id;

    // ── Case 1: Already the active key (idempotent restart) ───────────────
    if (currentActiveKeyId === keyId) {
      logger.info(
        { keyId, fingerprint, actor },
        "Signing key already ACTIVE in registry — idempotent restart.",
      );
      // Ensure at least one KEY_ACTIVATED event exists for audit continuity.
      const existingEvents = await tx
        .select({ id: signingKeyEventsTable.id })
        .from(signingKeyEventsTable)
        .where(
          and(
            eq(signingKeyEventsTable.keyId, keyId),
            eq(signingKeyEventsTable.eventType, "KEY_ACTIVATED"),
          ),
        )
        .limit(1);

      if (existingEvents.length === 0) {
        await tx.insert(signingKeyEventsTable).values({
          keyId,
          eventType: "KEY_ACTIVATED",
          effectiveAt: now,
          actor,
          reason: "Idempotent restart — event backfilled.",
        });
      }
      return; // transaction commits
    }

    // ── Case 2: Check if new key is REVOKED — fail closed ─────────────────
    const existingNewKey = await tx
      .select()
      .from(signingKeyRegistryTable)
      .where(eq(signingKeyRegistryTable.keyId, keyId))
      .limit(1);

    const existingEntry = existingNewKey[0];
    if (existingEntry?.status === "REVOKED") {
      throw new Error(
        `[FATAL] The signing key configured in ED25519_SECRET_KEY_HEX ` +
          `(key_id: ${keyId}, fingerprint: ${fingerprint}) is flagged as REVOKED ` +
          `in the signing key registry with reason: ` +
          `"${existingEntry.revocationReason ?? "(no reason recorded)"}". ` +
          `A revoked key must never be re-activated. ` +
          `Generate a new Ed25519 key pair, update ED25519_SECRET_KEY_HEX, and restart.`,
      );
    }

    // ── Case 3: Retire any other ACTIVE key ───────────────────────────────
    if (currentActiveKeyId && currentActiveKeyId !== keyId) {
      await tx
        .update(signingKeyRegistryTable)
        .set({ status: "RETIRED", retiredAt: now })
        .where(
          and(
            eq(signingKeyRegistryTable.keyId, currentActiveKeyId),
            eq(signingKeyRegistryTable.status, "ACTIVE"),
          ),
        );

      await tx.insert(signingKeyEventsTable).values({
        keyId: currentActiveKeyId,
        eventType: "KEY_RETIRED",
        effectiveAt: now,
        actor,
        reason: "Automatically retired — new signing key activated at startup.",
      });

      logger.info(
        { retiredKeyId: currentActiveKeyId, actor },
        "Previous ACTIVE signing key retired during startup rotation.",
      );
    }

    // ── Case 4: Activate the new key (INSERT or re-activate RETIRED) ──────
    if (existingEntry) {
      // Key exists as RETIRED — re-activate.
      await tx
        .update(signingKeyRegistryTable)
        .set({ status: "ACTIVE", activatedAt: now, retiredAt: null })
        .where(eq(signingKeyRegistryTable.keyId, keyId));
    } else {
      // New key — insert.
      await tx.insert(signingKeyRegistryTable).values({
        keyId,
        publicKey: publicKeyHex,
        fingerprint,
        algorithm: "Ed25519",
        signingMode,
        status: "ACTIVE",
        activatedAt: now,
      });
    }

    await tx.insert(signingKeyEventsTable).values({
      keyId,
      eventType: "KEY_ACTIVATED",
      effectiveAt: now,
      actor,
      reason: currentActiveKeyId && currentActiveKeyId !== keyId
        ? `Activated via startup rotation (retired key ${currentActiveKeyId}).`
        : existingEntry
          ? "Re-activated from RETIRED status."
          : "First activation.",
    });

    logger.info(
      { keyId, fingerprint, signingMode, actor },
      "Signing key activated in registry.",
    );
  });

  // Transaction committed — now hydrate in-memory map from DB.
  await _loadRegistryFromDb();

  return keyId;
}

// ─── Lifecycle mutations (transactional, fail-closed) ─────────────────────────

/**
 * Retire a key: marks it RETIRED so it can no longer sign new evidence,
 * but remains valid for historical signature verification.
 *
 * Rules:
 * • REVOKED keys cannot be demoted to RETIRED.
 * • Already-RETIRED is idempotent.
 * • The currently ACTIVE key cannot be retired via this API (rotation is the
 *   correct path: update env var + restart; or emergency: revoke).
 *
 * Writes a KEY_RETIRED event and updates the in-memory map on commit.
 * Throws on any DB error or invariant violation.
 */
export async function retireKeyInRegistry(
  keyId: string,
  actor: string,
  reason?: string,
): Promise<void> {
  const entry = getKeyById(keyId);
  if (!entry) throw new Error(`Key not found in registry: ${keyId}`);
  if (entry.status === "REVOKED") {
    throw new Error(
      `Key ${keyId} is REVOKED. Revocation is a stronger status — ` +
        "a revoked key cannot be demoted to merely retired.",
    );
  }
  if (entry.status === "ACTIVE") {
    throw new Error(
      `Key ${keyId} is currently ACTIVE. ` +
        "To retire the active signing key, either: " +
        "(a) update ED25519_SECRET_KEY_HEX and restart (clean rotation), or " +
        "(b) use POST /api/key-registry/:keyId/revoke for an emergency stop.",
    );
  }
  if (entry.status === "RETIRED") return; // idempotent

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(signingKeyRegistryTable)
      .set({ status: "RETIRED", retiredAt: now })
      .where(
        and(
          eq(signingKeyRegistryTable.keyId, keyId),
          ne(signingKeyRegistryTable.status, "REVOKED"),
        ),
      );

    await tx.insert(signingKeyEventsTable).values({
      keyId,
      eventType: "KEY_RETIRED",
      effectiveAt: now,
      actor,
      reason: reason ?? null,
    });
  });

  // Update in-memory map after commit.
  registryMap.set(keyId, { ...entry, status: "RETIRED", retiredAt: now });

  logger.info({ keyId, actor }, "Signing key retired.");
}

/**
 * Revoke a key: marks it REVOKED with a mandatory reason and records the
 * revocation timestamp (revokedAt) as a distinct field from retiredAt.
 *
 * If the key is currently ACTIVE, the caller (revokeCurrentSigningKey in
 * crypto.ts) must also clear _activeKeyId so signPayload() throws until a
 * replacement key is rotated in.
 *
 * Historical records signed under this key are preserved.  Auditors use
 * revokedAt to determine whether a given signature predates the revocation.
 *
 * Idempotent (preserves the first revocation reason and timestamp).
 * Throws on any DB error.
 */
export async function revokeKeyInRegistry(
  keyId: string,
  reason: string,
  actor: string,
): Promise<void> {
  const entry = getKeyById(keyId);
  if (!entry) throw new Error(`Key not found in registry: ${keyId}`);
  if (entry.status === "REVOKED") return; // idempotent

  const now = new Date();
  // retiredAt: if key was already RETIRED, keep that timestamp; otherwise set to now.
  const retiredAt = entry.retiredAt ?? now;

  await db.transaction(async (tx) => {
    await tx
      .update(signingKeyRegistryTable)
      .set({
        status: "REVOKED",
        retiredAt,
        revokedAt: now,
        revocationReason: reason,
      })
      .where(eq(signingKeyRegistryTable.keyId, keyId));

    await tx.insert(signingKeyEventsTable).values({
      keyId,
      eventType: "KEY_REVOKED",
      effectiveAt: now,
      actor,
      reason,
    });
  });

  // Update in-memory map after commit.
  registryMap.set(keyId, {
    ...entry,
    status: "REVOKED",
    retiredAt,
    revokedAt: now,
    revocationReason: reason,
  });

  logger.warn({ keyId, actor, reason }, "Signing key revoked.");
}

// ─── DB load (used after transactions + during restart simulation in tests) ───

export async function _loadRegistryFromDb(): Promise<void> {
  const rows = await db.select().from(signingKeyRegistryTable);
  for (const row of rows) {
    registryMap.set(row.keyId, {
      keyId: row.keyId,
      publicKey: row.publicKey,
      fingerprint: row.fingerprint,
      algorithm: "Ed25519",
      signingMode: row.signingMode,
      status: row.status as KeyStatus,
      activatedAt: row.activatedAt,
      retiredAt: row.retiredAt ?? null,
      revokedAt: row.revokedAt ?? null,
      revocationReason: row.revocationReason ?? null,
      createdAt: row.createdAt,
    });
  }
}

// ─── Test helpers (in-memory only, no DB) ────────────────────────────────────

/** Clear all in-memory registry entries. For test isolation ONLY. */
export function _clearRegistryForTesting(): void {
  registryMap.clear();
}

/**
 * Directly set an entry in the in-memory registry, bypassing all DB
 * operations.  Used by _reinitForTesting() and _simulateRotationForTesting()
 * in crypto.ts for pure unit test isolation.
 */
export function _setRegistryEntryForTesting(entry: KeyRegistryEntry): void {
  registryMap.set(entry.keyId, entry);
}

/**
 * Mark an in-memory key as RETIRED without touching the DB.
 * Used by _simulateRotationForTesting().
 */
export function _retireKeyInMemoryForTesting(keyId: string): void {
  const entry = registryMap.get(keyId);
  if (entry && entry.status === "ACTIVE") {
    registryMap.set(keyId, { ...entry, status: "RETIRED", retiredAt: new Date() });
  }
}
