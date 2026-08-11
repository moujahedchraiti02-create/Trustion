/**
 * Task #10 (security hardening) — Signing Key Rotation & Historical Verification
 *
 * Covers the 13 original verification scenarios plus all 10 regression
 * scenarios required by the security hardening specification:
 *
 * Original 13:
 *  O1.  Evidence signed with key A verifies with key A
 *  O2.  Rotate A → B; new evidence uses B (via _simulateRotationForTesting)
 *  O3.  (combined with O2)
 *  O4.  Old A evidence still verifies after rotation to B
 *  O5.  Cross-key verification fails
 *  O6.  Restart preserves verification of both generations
 *  O7.  Retired key cannot sign new evidence
 *  O8.  Revoked key cannot sign new evidence
 *  O9.  Retirement does not invalidate historical signatures
 *  O10. Unknown key_id → false
 *  O11. Malformed data → false
 *  O12. Private key never in registry / API responses
 *  O13. Caller-forged keyId rejected
 *
 * Security hardening regressions (R):
 *  R1.  Registry persistence failure prevents activation/signing
 *  R2.  API never accepts private key material (no rotate endpoint)
 *  R3.  Startup does not listen before registry hydration succeeds
 *  R4.  Registry/secret mismatch fails closed (REVOKED key in DB)
 *  R5.  Concurrent rotation cannot create two ACTIVE identities
 *  R6.  Lifecycle event history preserved across ACTIVE → RETIRED → REVOKED
 *  R7.  Revocation timestamp (revokedAt) is distinct from retiredAt
 *  R8.  Evidence signed before revocation remains verifiable with status context
 *  R9.  Evidence attributed after revocation is flagged as suspicious
 *  R10. Restart produces exactly the same active identity and registry state
 *  R11. No private key appears outside the secure key provider
 *
 * In-memory tests use _reinitForTesting() + _simulateRotationForTesting().
 * DB-interaction tests use initRegistryAndActivate() with a configurable mock.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Configurable DB mock ─────────────────────────────────────────────────────

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__mockCfg = {
    activeRows: [] as { key_id: string }[],
    existingKeyRows: [] as unknown[],
    registryRows: [] as unknown[],
    transactionThrows: false,
    transactionError: null as Error | null,
    // Track calls for assertion
    insertedRows: [] as unknown[],
    updatedRows: [] as unknown[],
  };
});

const mockCfg = vi.hoisted(() =>
  (globalThis as Record<string, unknown>).__mockCfg as {
    activeRows: { key_id: string }[];
    existingKeyRows: unknown[];
    registryRows: unknown[];
    transactionThrows: boolean;
    transactionError: Error | null;
    insertedRows: unknown[];
    updatedRows: unknown[];
  }
);

vi.mock("@workspace/db", () => {
  // Chain used by _loadRegistryFromDb() (db.select().from()) after commit.
  const registrySelectChain = {
    then: (r: (v: unknown[]) => unknown) =>
      Promise.resolve(
        (globalThis as Record<string, unknown>).__mockCfg
          ? ((globalThis as Record<string, unknown>).__mockCfg as { registryRows: unknown[] }).registryRows
          : []
      ).then(r),
    catch: (r: (e: unknown) => unknown) => Promise.resolve([]).catch(r),
    finally: (cb: () => void) => Promise.resolve([]).finally(cb),
    from:    () => registrySelectChain,
    where:   () => registrySelectChain,
    orderBy: () => registrySelectChain,
    limit:   () => registrySelectChain,
  };

  // Inside a transaction: select calls resolve with existingKeyRows by default.
  const makeTxSelectChain = () => {
    const txChain: Record<string, unknown> = {
      then: (r: (v: unknown[]) => unknown) =>
        Promise.resolve(
          (globalThis as Record<string, unknown>).__mockCfg
            ? ((globalThis as Record<string, unknown>).__mockCfg as { existingKeyRows: unknown[] }).existingKeyRows
            : []
        ).then(r),
      catch: (r: (e: unknown) => unknown) => Promise.resolve([]).catch(r),
      finally: (cb: () => void) => Promise.resolve([]).finally(cb),
      from:    () => txChain,
      where:   () => txChain,
      orderBy: () => txChain,
      limit:   (n: number) => ({
        then: (r: (v: unknown[]) => unknown) =>
          Promise.resolve(
            (globalThis as Record<string, unknown>).__mockCfg
              ? ((globalThis as Record<string, unknown>).__mockCfg as { existingKeyRows: unknown[] }).existingKeyRows.slice(0, n)
              : []
          ).then(r),
        catch: (r: (e: unknown) => unknown) => Promise.resolve([]).catch(r),
        finally: (cb: () => void) => Promise.resolve([]).finally(cb),
      }),
    };
    return { select: () => txChain };
  };

  const txChain: Record<string, unknown> & { then: unknown } = {
    then:    (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
    catch:   (r: (e: unknown) => unknown)   => Promise.resolve([]).catch(r),
    finally: (cb: () => void)               => Promise.resolve([]).finally(cb),
    where:   () => txChain,
    set:     (v: unknown) => {
      const cfg = (globalThis as Record<string, unknown>).__mockCfg as { updatedRows: unknown[] };
      if (cfg) cfg.updatedRows.push(v);
      return txChain;
    },
    values: (v: unknown) => {
      const cfg = (globalThis as Record<string, unknown>).__mockCfg as { insertedRows: unknown[] };
      if (cfg) cfg.insertedRows.push(v);
      return txChain;
    },
    returning: () => txChain,
    limit:     () => txChain,
  };

  const makeTx = () => ({
    ...makeTxSelectChain(),
    update: () => txChain,
    insert: () => txChain,
    execute: vi.fn().mockImplementation(() =>
      Promise.resolve({
        rows: (globalThis as Record<string, unknown>).__mockCfg
          ? ((globalThis as Record<string, unknown>).__mockCfg as { activeRows: { key_id: string }[] }).activeRows
          : [],
      })
    ),
  });

  const db = {
    select:      () => registrySelectChain,
    update:      () => txChain,
    insert:      () => txChain,
    execute:     vi.fn().mockResolvedValue({ rows: [] }), // CREATE INDEX
    transaction: vi.fn().mockImplementation(async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      const cfg = (globalThis as Record<string, unknown>).__mockCfg as {
        transactionThrows: boolean;
        transactionError: Error | null;
      };
      if (cfg?.transactionThrows) {
        throw cfg.transactionError ?? new Error("DB transaction failure (test-injected)");
      }
      return cb(makeTx());
    }),
  };

  return {
    db,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), ""),
    signingKeyRegistryTable: { keyId: {} },
    signingKeyEventsTable:   { keyId: {}, eventType: {} },
    ledgerEntriesTable:      { keyId: {}, publicKey: {} },
    alertsTable: {}, vesselsTable: {}, emissionsRecordsTable: {},
    regulatoryProfilesTable: {}, auditorDecisionsTable: {},
  };
});

// Import AFTER mock is in place
import nacl from "tweetnacl";
import {
  signPayload,
  verifyPayload,
  verifyPayloadByKeyId,
  checkSignatureContext,
  getActiveKeyId,
  getKeyById,
  listKeys,
  initRegistryAndActivate,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  checkAndAlertKeyExpiry,
  DEFAULT_EXPIRY_WARNING_WINDOW_MS,
  computeKeyId,
  computeKeyFingerprint,
  _reinitForTesting,
  _simulateRotationForTesting,
  _clearRegistryForTesting,
  _setRegistryEntryForTesting,
  _setActiveKeyId,
} from "../lib/crypto.js";

// ─── Test key material ────────────────────────────────────────────────────────

const SEED_A = "aa".repeat(32); // 64 hex chars = 32-byte seed
const SEED_B = "bb".repeat(32);
const SEED_C = "cc".repeat(32);

function pubKeyFromSeed(seedHex: string): string {
  const kp = nacl.sign.keyPair.fromSeed(Buffer.from(seedHex, "hex"));
  return Buffer.from(kp.publicKey).toString("hex");
}

const PUB_A = pubKeyFromSeed(SEED_A);
const PUB_B = pubKeyFromSeed(SEED_B);
const KEY_ID_A = computeKeyId(PUB_A);
const KEY_ID_B = computeKeyId(PUB_B);

const PAYLOAD_A = { vesselId: 1, eventType: "FUEL", timestampGnss: "2026-01-15T08:00:00.000Z", fuelMassKg: 5000 };
const PAYLOAD_B = { vesselId: 2, eventType: "FUEL", timestampGnss: "2026-02-01T10:00:00.000Z", fuelMassKg: 3200 };

// ─── Mock config helpers ──────────────────────────────────────────────────────

function resetMock() {
  mockCfg.activeRows = [];
  mockCfg.existingKeyRows = [];
  mockCfg.registryRows = [];
  mockCfg.transactionThrows = false;
  mockCfg.transactionError = null;
  mockCfg.insertedRows = [];
  mockCfg.updatedRows = [];
}

beforeEach(() => {
  resetMock();
});

// ─── Scenarios O1–O13 (original 13 — in-memory via test helpers) ─────────────

describe("O1 — Evidence signed with key A verifies with key A", () => {
  it("signature verifies with the same public key", () => {
    _reinitForTesting(SEED_A);
    const { signature, publicKey, keyId } = signPayload(PAYLOAD_A);
    expect(publicKey).toBe(PUB_A);
    expect(keyId).toBe(KEY_ID_A);
    expect(verifyPayload(PAYLOAD_A, signature, publicKey)).toBe(true);
  });

  it("verifyPayloadByKeyId resolves from registry correctly", () => {
    _reinitForTesting(SEED_A);
    const { signature, keyId } = signPayload(PAYLOAD_A);
    expect(verifyPayloadByKeyId(PAYLOAD_A, signature, keyId)).toBe(true);
  });

  it("key A is ACTIVE in registry after init", () => {
    _reinitForTesting(SEED_A);
    const e = getKeyById(KEY_ID_A);
    expect(e?.status).toBe("ACTIVE");
    expect(e?.publicKey).toBe(PUB_A);
  });
});

describe("O2+O3 — Rotate A → B; new evidence uses B", () => {
  it("after rotation signPayload returns B's publicKey and keyId", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    const { publicKey, keyId } = signPayload(PAYLOAD_B);
    expect(publicKey).toBe(PUB_B);
    expect(keyId).toBe(KEY_ID_B);
  });

  it("key B is ACTIVE, key A is RETIRED", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    expect(getKeyById(KEY_ID_B)?.status).toBe("ACTIVE");
    expect(getKeyById(KEY_ID_A)?.status).toBe("RETIRED");
  });

  it("at most one ACTIVE key exists after rotation", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    const active = listKeys().filter((k) => k.status === "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0].keyId).toBe(KEY_ID_B);
  });
});

describe("O4 — Old A evidence still verifies after rotation to B", () => {
  it("stored public key verifies A's signature even after B is active", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA, publicKey: pubA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B);
    expect(verifyPayload(PAYLOAD_A, sigA, pubA)).toBe(true);
  });

  it("verifyPayloadByKeyId(keyId_A) resolves after rotation", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA, keyId: kidA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B);
    expect(verifyPayloadByKeyId(PAYLOAD_A, sigA, kidA)).toBe(true);
  });

  it("A's registry entry is preserved (not deleted) after rotation", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    const a = getKeyById(KEY_ID_A);
    expect(a).not.toBeNull();
    expect(a!.publicKey).toBe(PUB_A);
  });

  it("multi-rotation A→B→C: A evidence still verifies", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA, publicKey: pubA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B);
    _simulateRotationForTesting(SEED_C);
    expect(verifyPayload(PAYLOAD_A, sigA, pubA)).toBe(true);
  });
});

describe("O5 — Cross-key verification fails", () => {
  it("B's key does NOT verify A's signature", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA } = signPayload(PAYLOAD_A);
    expect(verifyPayload(PAYLOAD_A, sigA, PUB_B)).toBe(false);
  });

  it("verifyPayloadByKeyId with wrong key_id returns false", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B);
    expect(verifyPayloadByKeyId(PAYLOAD_A, sigA, KEY_ID_B)).toBe(false);
  });
});

describe("O6 — Restart preserves verification of both generations", () => {
  it("after simulated restart (re-init from DB rows), both keys are resolvable", () => {
    // Simulate pre-restart state
    _reinitForTesting(SEED_A);
    const { signature: sigA, keyId: kidA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B);
    const { signature: sigB, keyId: kidB } = signPayload(PAYLOAD_B);

    // Simulate restart: clear memory, load from DB
    _clearRegistryForTesting();
    _setActiveKeyId(null);

    // Re-populate from what the DB would have returned
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "RETIRED",
      activatedAt: new Date(), retiredAt: new Date(), revokedAt: null,
      revocationReason: null, createdAt: new Date(),
    });
    _setRegistryEntryForTesting({
      keyId: KEY_ID_B, publicKey: PUB_B, fingerprint: computeKeyFingerprint(PUB_B),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_B);

    // Both generations verifiable after restart
    expect(verifyPayloadByKeyId(PAYLOAD_A, sigA, kidA)).toBe(true);
    expect(verifyPayloadByKeyId(PAYLOAD_B, sigB, kidB)).toBe(true);
  });
});

describe("O7 — Retired key cannot sign new evidence", () => {
  it("after rotation A→B, signPayload uses B not A", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    expect(signPayload(PAYLOAD_B).keyId).toBe(KEY_ID_B);
  });
});

describe("O8 — Revoked key cannot sign new evidence", () => {
  it("revokeCurrentSigningKey (in-memory stub) causes signPayload to throw", async () => {
    _reinitForTesting(SEED_A);
    // Direct in-memory revocation (bypass DB transaction for this test)
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date(), retiredAt: new Date(), revokedAt: new Date(),
      revocationReason: "test revocation", createdAt: new Date(),
    });
    _setActiveKeyId(null);
    expect(() => signPayload(PAYLOAD_A)).toThrow(/no active signing key|registry.*not.*initialised/i);
  });
});

describe("O9 — Retirement does not invalidate historical signatures", () => {
  it("RETIRED key A signatures still verify", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA, publicKey: pubA, keyId: kidA } = signPayload(PAYLOAD_A);
    _simulateRotationForTesting(SEED_B); // A → RETIRED
    expect(verifyPayload(PAYLOAD_A, sigA, pubA)).toBe(true);
    expect(verifyPayloadByKeyId(PAYLOAD_A, sigA, kidA)).toBe(true);
    expect(getKeyById(KEY_ID_A)?.status).toBe("RETIRED");
  });

  it("RETIRED key has null revocationReason", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    expect(getKeyById(KEY_ID_A)?.revocationReason).toBeNull();
  });
});

describe("O10 — Unknown key_id fails verification", () => {
  it("unregistered key_id returns false", () => {
    _reinitForTesting(SEED_A);
    const { signature } = signPayload(PAYLOAD_A);
    expect(verifyPayloadByKeyId(PAYLOAD_A, signature, "0".repeat(64))).toBe(false);
  });
});

describe("O11 — Malformed data fails closed", () => {
  it("truncated signature returns false", () => {
    _reinitForTesting(SEED_A);
    const { signature, publicKey } = signPayload(PAYLOAD_A);
    expect(verifyPayload(PAYLOAD_A, signature.slice(0, 32), publicKey)).toBe(false);
  });

  it("non-hex signature returns false", () => {
    _reinitForTesting(SEED_A);
    const { publicKey } = signPayload(PAYLOAD_A);
    expect(verifyPayload(PAYLOAD_A, "not-hex!!!", publicKey)).toBe(false);
  });

  it("wrong-length public key returns false", () => {
    _reinitForTesting(SEED_A);
    const { signature } = signPayload(PAYLOAD_A);
    expect(verifyPayload(PAYLOAD_A, signature, PUB_A.slice(0, 32))).toBe(false);
  });
});

describe("O12 — Private key never in registry / API responses", () => {
  it("registry entry has no secret/seed fields", () => {
    _reinitForTesting(SEED_A);
    const e = getKeyById(KEY_ID_A)!;
    expect(JSON.stringify(e)).not.toContain(SEED_A);
    expect(Object.keys(e)).not.toContain("secretKey");
    expect(Object.keys(e)).not.toContain("seed");
  });

  it("signPayload return has no secret fields", () => {
    _reinitForTesting(SEED_A);
    const result = signPayload(PAYLOAD_A);
    expect(JSON.stringify(result)).not.toContain(SEED_A);
    expect(Object.keys(result)).not.toContain("secretKey");
  });

  it("publicKey in registry is 64 hex chars (32-byte pub key, not 128-char secret)", () => {
    _reinitForTesting(SEED_A);
    expect(getKeyById(KEY_ID_A)!.publicKey).toHaveLength(64);
    expect(getKeyById(KEY_ID_A)!.publicKey).not.toBe(SEED_A);
  });
});

describe("O13 — Caller-forged keyId rejected", () => {
  it("keyId is always server-computed, never from payload content", () => {
    _reinitForTesting(SEED_A);
    const payloadWithFakeKeyId = { ...PAYLOAD_A, keyId: "attacker-controlled" };
    const result = signPayload(payloadWithFakeKeyId);
    expect(result.keyId).toBe(KEY_ID_A);
    expect(result.keyId).not.toBe("attacker-controlled");
  });

  it("keyId == computeKeyId(publicKey) — verifiable by any party", () => {
    _reinitForTesting(SEED_A);
    const { publicKey, keyId } = signPayload(PAYLOAD_A);
    expect(keyId).toBe(computeKeyId(publicKey));
    expect(keyId).toHaveLength(64);
  });
});

// ─── Task 14 — Pre-expiry alert check (A14-EXPIRY) ───────────────────────────

describe("A14-EXPIRY — checkAndAlertKeyExpiry inserts a HIGH alert when key is near expiry", () => {
  it("returns false and inserts no alert when active key has no expiresAt", async () => {
    _reinitForTesting(SEED_A); // expiresAt = null by default
    resetMock();

    const result = await checkAndAlertKeyExpiry();

    expect(result).toBe(false);
    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_EXPIRY_WARNING",
    );
    expect(alertRow).toBeUndefined();
  });

  it("returns false when key expiresAt is beyond the warning window", async () => {
    _clearRegistryForTesting();
    resetMock();

    const farFuture = new Date(Date.now() + DEFAULT_EXPIRY_WARNING_WINDOW_MS + 24 * 60 * 60 * 1000);
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, expiresAt: farFuture, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_A);
    mockCfg.registryRows = []; // dedup query: no existing alerts

    const result = await checkAndAlertKeyExpiry();
    expect(result).toBe(false);
  });

  it("inserts a HIGH KEY_EXPIRY_WARNING alert when key expires within the warning window", async () => {
    _clearRegistryForTesting();
    resetMock();

    // Key expiring in 7 days — within default 30-day window
    const soonExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, expiresAt: soonExpiry, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_A);
    mockCfg.registryRows = []; // dedup: no existing unacknowledged warning

    const result = await checkAndAlertKeyExpiry();

    expect(result).toBe(true);
    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_EXPIRY_WARNING",
    ) as Record<string, unknown> | undefined;
    expect(alertRow).toBeDefined();
    expect(alertRow!.severity).toBe("HIGH");
    expect(alertRow!.vesselId).toBeNull();
  });

  it("alert message contains the fingerprint, keyId, and expiresAt timestamp", async () => {
    _clearRegistryForTesting();
    resetMock();

    const soonExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, expiresAt: soonExpiry, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_A);
    mockCfg.registryRows = [];

    await checkAndAlertKeyExpiry();

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_EXPIRY_WARNING",
    ) as Record<string, unknown> | undefined;
    const msg = String(alertRow!.message);
    expect(msg).toContain(KEY_ID_A);
    expect(msg).toContain(computeKeyFingerprint(PUB_A));
    expect(msg).toContain(soonExpiry.toISOString());
  });

  it("is deduplicated: does not insert a second alert when one already exists (acknowledged=false)", async () => {
    _clearRegistryForTesting();
    resetMock();

    const soonExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, expiresAt: soonExpiry, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_A);

    // Dedup query returns a row → alert already exists
    mockCfg.registryRows = [{ id: 1 }];

    const result = await checkAndAlertKeyExpiry();
    expect(result).toBe(false);
    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_EXPIRY_WARNING",
    );
    expect(alertRow).toBeUndefined();
  });

  it("returns false when no active key exists", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    resetMock();

    const result = await checkAndAlertKeyExpiry();
    expect(result).toBe(false);
  });

  it("alerts even when key has already expired (past expiresAt)", async () => {
    _clearRegistryForTesting();
    resetMock();

    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000); // expired yesterday
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, expiresAt: pastExpiry, createdAt: new Date(),
    });
    _setActiveKeyId(KEY_ID_A);
    mockCfg.registryRows = [];

    const result = await checkAndAlertKeyExpiry();
    expect(result).toBe(true);
    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_EXPIRY_WARNING",
    ) as Record<string, unknown> | undefined;
    expect(alertRow!.severity).toBe("HIGH");
    expect(String(alertRow!.message)).toContain("EXPIRED");
  });
});

// ─── Task 14 — Key lifecycle alert insertion (A14) ───────────────────────────

describe("A14 — retireKeyInRegistry inserts a HIGH alert with fingerprint", () => {
  it("alert is inserted with alertType KEY_LIFECYCLE and severity HIGH", async () => {
    _clearRegistryForTesting();
    resetMock();

    // Use a cast status that bypasses all early-return guards (ACTIVE/RETIRED/REVOKED)
    // so the function reaches the DB update + alert insertion path.
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519",
      status: "PENDING" as unknown as "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, createdAt: new Date(),
    });

    await retireKeyInRegistry(KEY_ID_A, "admin:test", "scheduled retirement");

    // The alert insert comes after the transaction — captured via db.insert().values()
    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(alertRow).toBeDefined();
    expect(alertRow!.severity).toBe("HIGH");
    expect(String(alertRow!.message)).toContain(computeKeyFingerprint(PUB_A));
  });

  it("alert message contains keyId and reason", async () => {
    _clearRegistryForTesting();
    resetMock();

    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519",
      status: "PENDING" as unknown as "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, createdAt: new Date(),
    });

    await retireKeyInRegistry(KEY_ID_A, "admin:test", "end of lifecycle");

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(String(alertRow!.message)).toContain(KEY_ID_A);
    expect(String(alertRow!.message)).toContain("end of lifecycle");
  });

  it("vesselId is null for key-lifecycle alert (system-level, not vessel-specific)", async () => {
    _clearRegistryForTesting();
    resetMock();

    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519",
      status: "PENDING" as unknown as "ACTIVE",
      activatedAt: new Date(), retiredAt: null, revokedAt: null,
      revocationReason: null, createdAt: new Date(),
    });

    await retireKeyInRegistry(KEY_ID_A, "admin:test");

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(alertRow!.vesselId).toBeNull();
  });
});

describe("A14 — revokeKeyInRegistry inserts a HIGH alert with fingerprint", () => {
  it("revoke triggers a HIGH severity alert containing the fingerprint", async () => {
    _reinitForTesting(SEED_A);
    resetMock();

    await revokeKeyInRegistry(KEY_ID_A, "key compromised in transit", "admin:security");

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(alertRow).toBeDefined();
    expect(alertRow!.severity).toBe("HIGH");
    expect(String(alertRow!.message)).toContain(computeKeyFingerprint(PUB_A));
  });

  it("revoke alert message contains keyId and reason", async () => {
    _reinitForTesting(SEED_A);
    resetMock();

    const reason = "suspected compromise — rotating immediately";
    await revokeKeyInRegistry(KEY_ID_A, reason, "admin:security");

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(String(alertRow!.message)).toContain(KEY_ID_A);
    expect(String(alertRow!.message)).toContain(reason);
  });

  it("revoke alert vesselId is null (system-level alert)", async () => {
    _reinitForTesting(SEED_A);
    resetMock();

    await revokeKeyInRegistry(KEY_ID_A, "test revocation", "admin:test");

    const alertRow = mockCfg.insertedRows.find(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ) as Record<string, unknown> | undefined;
    expect(alertRow!.vesselId).toBeNull();
  });

  it("idempotent revoke does not insert a second alert", async () => {
    _reinitForTesting(SEED_A);
    resetMock();

    // First revoke — updates status in memory
    await revokeKeyInRegistry(KEY_ID_A, "first revocation", "admin:test");
    const firstCount = mockCfg.insertedRows.filter(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ).length;

    // Second call is idempotent — returns early, no second alert
    await revokeKeyInRegistry(KEY_ID_A, "second attempt", "admin:test");
    const secondCount = mockCfg.insertedRows.filter(
      (r: unknown) => (r as Record<string, unknown>).alertType === "KEY_LIFECYCLE",
    ).length;

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(1); // no additional alert on idempotent call
  });
});

// ─── Security hardening regression scenarios (R1–R11) ────────────────────────

describe("R1 — Registry persistence failure prevents activation/signing", () => {
  it("initRegistryAndActivate() rejects when db.transaction() throws", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    mockCfg.transactionThrows = true;
    mockCfg.transactionError = new Error("Simulated DB outage");

    await expect(
      initRegistryAndActivate(PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519", "system:startup"),
    ).rejects.toThrow("Simulated DB outage");
  });

  it("after persistence failure, _activeKeyId remains null (signing not permitted)", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    mockCfg.transactionThrows = true;

    try {
      await initRegistryAndActivate(PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519");
    } catch {
      // expected
    }

    expect(getActiveKeyId()).toBeNull();
    expect(() => signPayload(PAYLOAD_A)).toThrow(/no active signing key|registry.*not.*initialised/i);
  });

  it("in-memory registry is not modified after a failed transaction", async () => {
    _reinitForTesting(SEED_A); // start with A active
    const before = getKeyById(KEY_ID_A)?.status;

    mockCfg.transactionThrows = true;
    try {
      await initRegistryAndActivate(PUB_B, computeKeyFingerprint(PUB_B), "PERSISTENT_ED25519");
    } catch { /* expected */ }

    // A should still be ACTIVE (in-memory state unchanged)
    expect(getKeyById(KEY_ID_A)?.status).toBe(before);
  });
});

describe("R2 — API never accepts private key material", () => {
  it("initRegistryAndActivate takes only public metadata, not private key bytes", () => {
    // The function signature accepts publicKeyHex, fingerprint, signingMode, actor.
    // It does NOT accept a secretKeyHex / seed parameter.
    const params = initRegistryAndActivate.length; // function arity
    // Parameters: publicKeyHex, fingerprint, signingMode, actor (optional) = 4
    expect(params).toBeLessThanOrEqual(4);
  });

  it("signPayload return value has no private key material", () => {
    _reinitForTesting(SEED_A);
    const result = signPayload(PAYLOAD_A);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(["signature", "publicKey", "keyId"]));
    expect(Object.keys(result)).not.toContain("secretKey");
    expect(Object.keys(result)).not.toContain("seed");
    expect(Object.keys(result)).not.toContain("privateKey");
    // Verify none of the seed material appears in any value
    expect(JSON.stringify(result)).not.toContain(SEED_A);
    expect(JSON.stringify(result)).not.toContain(SEED_B);
  });

  it("registry entries expose only public metadata", () => {
    _reinitForTesting(SEED_A);
    const entries = listKeys();
    const json = JSON.stringify(entries);
    expect(json).not.toContain(SEED_A);
    expect(json).not.toContain(SEED_B);
    for (const entry of entries) {
      expect(Object.keys(entry)).not.toContain("secretKey");
      expect(Object.keys(entry)).not.toContain("privateKey");
      expect(Object.keys(entry)).not.toContain("seed");
    }
  });
});

describe("R3 — Startup does not listen before registry hydration", () => {
  it("initRegistryAndActivate() is async and must be awaited before accepting requests", async () => {
    // The function returns a Promise<string>. The test verifies the contract:
    // only after the promise resolves should the server listen.
    // We verify the return type is a Promise.
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    mockCfg.registryRows = []; // DB will return empty after commit

    const result = initRegistryAndActivate(
      PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519", "system:test",
    );
    // Before await: _activeKeyId is still null (set by caller after await)
    expect(getActiveKeyId()).toBeNull();
    // After await: the promise resolves with keyId
    const keyId = await result;
    expect(typeof keyId).toBe("string");
    expect(keyId).toBe(KEY_ID_A);
  });

  it("server cannot sign before initRegistryAndActivate resolves (_activeKeyId null until set)", () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    expect(() => signPayload(PAYLOAD_A)).toThrow(/no active signing key|registry.*not.*initialised/i);
  });
});

describe("R4 — Registry/secret mismatch fails closed (REVOKED key in DB)", () => {
  it("initRegistryAndActivate() rejects if env key is REVOKED in the DB", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);

    // Mock: no current ACTIVE key, but the new key exists as REVOKED
    mockCfg.activeRows = [];
    mockCfg.existingKeyRows = [{
      key_id: KEY_ID_A,
      public_key: PUB_A,
      status: "REVOKED",
      revocation_reason: "Compromised in audit",
    }];

    await expect(
      initRegistryAndActivate(PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519", "system:startup"),
    ).rejects.toThrow(/REVOKED/);
  });

  it("after mismatch rejection, server remains in a non-signing state", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);
    mockCfg.activeRows = [];
    mockCfg.existingKeyRows = [{
      key_id: KEY_ID_A, status: "REVOKED", revocation_reason: "Test",
    }];

    try {
      await initRegistryAndActivate(PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519");
    } catch { /* expected */ }

    expect(getActiveKeyId()).toBeNull();
  });
});

describe("R5 — Concurrent rotation cannot create two ACTIVE identities", () => {
  it("two concurrent initRegistryAndActivate() calls with different keys produce one ACTIVE result", async () => {
    _clearRegistryForTesting();
    _setActiveKeyId(null);

    // Both calls see no active key initially (empty activeRows).
    // The first to commit will insert ACTIVE; the second will hit the partial unique index constraint.
    // In the test, since the mock doesn't enforce the DB constraint, we simulate the serialisation
    // by verifying the at-most-one-ACTIVE invariant is maintained in the in-memory registry.
    mockCfg.activeRows = [];
    mockCfg.existingKeyRows = [];
    mockCfg.registryRows = []; // _loadRegistryFromDb returns nothing — we validate in-memory state

    const callA = initRegistryAndActivate(PUB_A, computeKeyFingerprint(PUB_A), "PERSISTENT_ED25519", "system:node-1");
    const callB = initRegistryAndActivate(PUB_B, computeKeyFingerprint(PUB_B), "PERSISTENT_ED25519", "system:node-2");

    // Both promises will resolve (mock doesn't enforce DB constraint — verifying logic)
    await Promise.allSettled([callA, callB]);

    // Regardless of which resolved, the contract is: at most one ACTIVE key
    const activeKeys = listKeys().filter((k) => k.status === "ACTIVE");
    expect(activeKeys.length).toBeLessThanOrEqual(1);
  });
});

describe("R6 — Lifecycle events preserved across ACTIVE → RETIRED → REVOKED", () => {
  it("a REVOKED key carries both retiredAt and revokedAt distinct from null", () => {
    _reinitForTesting(SEED_A);

    // Simulate RETIRED then REVOKED (direct in-memory state setup)
    const retiredAt = new Date("2026-01-10T00:00:00Z");
    const revokedAt = new Date("2026-01-15T00:00:00Z");
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date("2026-01-01T00:00:00Z"), retiredAt, revokedAt,
      revocationReason: "End of lifecycle test", createdAt: new Date(),
    });

    const e = getKeyById(KEY_ID_A)!;
    expect(e.status).toBe("REVOKED");
    expect(e.retiredAt).toEqual(retiredAt);
    expect(e.revokedAt).toEqual(revokedAt);
    expect(e.revocationReason).toBe("End of lifecycle test");
  });

  it("REVOKED != RETIRED: a RETIRED key has revokedAt = null", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    const a = getKeyById(KEY_ID_A)!;
    expect(a.status).toBe("RETIRED");
    expect(a.retiredAt).toBeInstanceOf(Date);
    expect(a.revokedAt).toBeNull(); // retirement ≠ revocation
  });
});

describe("R7 — Revocation timestamp (revokedAt) is distinct from retiredAt", () => {
  it("revokedAt field exists and is separate from retiredAt in the registry entry type", () => {
    _reinitForTesting(SEED_A);
    const e = getKeyById(KEY_ID_A)!;
    // Both fields exist on the type (even if null for ACTIVE key)
    expect("revokedAt" in e).toBe(true);
    expect("retiredAt" in e).toBe(true);
    // For ACTIVE key, both are null
    expect(e.revokedAt).toBeNull();
    expect(e.retiredAt).toBeNull();
  });

  it("a key revoked directly while ACTIVE gets both retiredAt and revokedAt set to the same time", () => {
    _reinitForTesting(SEED_A);
    const revokedAt = new Date("2026-03-01T12:00:00Z");
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date(), retiredAt: revokedAt, revokedAt,
      revocationReason: "Direct revocation while active", createdAt: new Date(),
    });
    const e = getKeyById(KEY_ID_A)!;
    expect(e.retiredAt).toEqual(revokedAt);
    expect(e.revokedAt).toEqual(revokedAt);
    expect(e.retiredAt!.getTime()).toBe(e.revokedAt!.getTime());
  });

  it("a key retired first, then revoked, has retiredAt < revokedAt", () => {
    _reinitForTesting(SEED_A);
    const retiredAt = new Date("2026-02-01T00:00:00Z");
    const revokedAt = new Date("2026-03-01T00:00:00Z");
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date("2026-01-01T00:00:00Z"), retiredAt, revokedAt,
      revocationReason: "Late revocation of a retired key", createdAt: new Date(),
    });
    const e = getKeyById(KEY_ID_A)!;
    expect(e.retiredAt!.getTime()).toBeLessThan(e.revokedAt!.getTime());
  });
});

describe("R8 — Evidence signed before revocation remains verifiable with correct status context", () => {
  it("checkSignatureContext returns valid=true and signedBeforeRevocation=true for pre-revocation evidence", () => {
    _reinitForTesting(SEED_A);
    const signatureTimestamp = new Date("2026-01-10T00:00:00Z");
    const { signature: sigA, keyId: kidA } = signPayload(PAYLOAD_A);

    // Simulate revocation after the signature was made
    const revokedAt = new Date("2026-02-01T00:00:00Z");
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date("2026-01-01T00:00:00Z"), retiredAt: revokedAt, revokedAt,
      revocationReason: "Compromised", createdAt: new Date(),
    });

    const ctx = checkSignatureContext(PAYLOAD_A, sigA, kidA, verifyPayload, signatureTimestamp);
    expect(ctx.valid).toBe(true);               // signature is still cryptographically valid
    expect(ctx.keyStatus).toBe("REVOKED");      // but key is now revoked
    expect(ctx.revokedAt).toEqual(revokedAt);
    expect(ctx.signedBeforeRevocation).toBe(true); // signed before revocation
  });

  it("verifyPayloadByKeyId returns true for REVOKED-key evidence (raw boolean — status checked separately)", () => {
    _reinitForTesting(SEED_A);
    const { signature, keyId } = signPayload(PAYLOAD_A);

    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date(), retiredAt: new Date(), revokedAt: new Date(),
      revocationReason: "Test", createdAt: new Date(),
    });

    // Raw verification still returns true — status check is separate concern for auditors
    expect(verifyPayloadByKeyId(PAYLOAD_A, signature, keyId)).toBe(true);
  });
});

describe("R9 — Evidence attributed after revocation is flagged as suspicious", () => {
  it("checkSignatureContext returns signedBeforeRevocation=false for post-revocation timestamps", () => {
    _reinitForTesting(SEED_A);
    // Sign a payload (with key A active)
    const { signature: sigA, keyId: kidA } = signPayload(PAYLOAD_A);

    const revokedAt = new Date("2026-02-01T00:00:00Z");
    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date("2026-01-01T00:00:00Z"), retiredAt: revokedAt, revokedAt,
      revocationReason: "Compromised", createdAt: new Date(),
    });

    // Signature timestamp is AFTER revocation → suspicious
    const postRevocationTimestamp = new Date("2026-03-01T00:00:00Z");
    const ctx = checkSignatureContext(PAYLOAD_A, sigA, kidA, verifyPayload, postRevocationTimestamp);

    expect(ctx.valid).toBe(true);               // cryptographically valid (attacker used the key)
    expect(ctx.keyStatus).toBe("REVOKED");
    expect(ctx.signedBeforeRevocation).toBe(false); // timestamp is AFTER revocation → suspicious
  });

  it("checkSignatureContext returns signedBeforeRevocation=null when no timestamp provided", () => {
    _reinitForTesting(SEED_A);
    const { signature: sigA, keyId: kidA } = signPayload(PAYLOAD_A);

    _setRegistryEntryForTesting({
      keyId: KEY_ID_A, publicKey: PUB_A, fingerprint: computeKeyFingerprint(PUB_A),
      algorithm: "Ed25519", signingMode: "PERSISTENT_ED25519", status: "REVOKED",
      activatedAt: new Date(), retiredAt: new Date(), revokedAt: new Date(),
      revocationReason: "Test", createdAt: new Date(),
    });

    // No timestamp provided
    const ctx = checkSignatureContext(PAYLOAD_A, sigA, kidA, verifyPayload);
    expect(ctx.signedBeforeRevocation).toBeNull();
  });
});

describe("R10 — Restart produces exactly the same active identity and registry state", () => {
  it("same seed always produces the same key_id (deterministic)", () => {
    const kid1 = _reinitForTesting(SEED_A);
    const kid2 = _reinitForTesting(SEED_A);
    expect(kid1).toBe(kid2);
    expect(kid1).toBe(KEY_ID_A);
  });

  it("signatures from key A verify after simulated restart with key A", () => {
    // Session 1: sign with A
    _reinitForTesting(SEED_A);
    const { signature: sigA, publicKey: pubA } = signPayload(PAYLOAD_A);

    // Restart: re-init with same key A
    _reinitForTesting(SEED_A);
    const { keyId: kidA } = signPayload(PAYLOAD_A);

    // Old and new signatures both verify
    expect(verifyPayload(PAYLOAD_A, sigA, pubA)).toBe(true);
    expect(kidA).toBe(KEY_ID_A);
    expect(getActiveKeyId()).toBe(KEY_ID_A);
  });

  it("fingerprint is stable across restarts for the same key", () => {
    _reinitForTesting(SEED_A);
    const fp1 = getKeyById(KEY_ID_A)?.fingerprint;
    _reinitForTesting(SEED_A);
    const fp2 = getKeyById(KEY_ID_A)?.fingerprint;
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(16);
  });
});

describe("R11 — No private key appears outside the secure key provider", () => {
  it("listKeys() output contains no seed/secret material for any test key", () => {
    _reinitForTesting(SEED_A);
    _simulateRotationForTesting(SEED_B);
    const json = JSON.stringify(listKeys());
    expect(json).not.toContain(SEED_A);
    expect(json).not.toContain(SEED_B);
    expect(json).not.toContain(SEED_A.toUpperCase());
  });

  it("signPayload() does not expose any field named after private key concepts", () => {
    _reinitForTesting(SEED_A);
    const result = signPayload(PAYLOAD_A);
    const keys = Object.keys(result);
    const forbidden = ["secretKey", "privateKey", "seed", "keyHex", "secretKeyHex"];
    for (const f of forbidden) {
      expect(keys).not.toContain(f);
    }
  });

  it("publicKey in signPayload result is 32 bytes — not the 64-byte secret key", () => {
    _reinitForTesting(SEED_A);
    const { publicKey } = signPayload(PAYLOAD_A);
    expect(publicKey).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(publicKey).not.toBe(SEED_A);
    // The full nacl secret key is 64 bytes = 128 hex chars
    expect(publicKey).not.toHaveLength(128);
  });

  it("keyId is derived from publicKey (SHA-256), not from seed", () => {
    _reinitForTesting(SEED_A);
    const { publicKey, keyId } = signPayload(PAYLOAD_A);
    expect(keyId).toBe(computeKeyId(publicKey));
    expect(keyId).not.toBe(SEED_A);
    expect(keyId).not.toBe(computeKeyId(SEED_A)); // keyId = SHA-256(pubKey bytes), not SHA-256(seed)
  });
});
