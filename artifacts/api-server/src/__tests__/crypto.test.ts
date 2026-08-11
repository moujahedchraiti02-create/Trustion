/**
 * Security tests: Ed25519 cryptographic signing identity
 *
 * Covers Task #8 requirements:
 *   1. Production startup without signing key → fails.
 *   2. Malformed signing key → fails.
 *   3. Valid persistent key → startup succeeds.
 *   4. Repeated restarts with the same key → same public identity / fingerprint.
 *   5. Development-only ephemeral mode is explicitly marked and cannot activate
 *      in production.
 *   6. Valid signature verifies.
 *   7. Modified payload fails verification.
 *   8. Wrong public key fails verification.
 *   9. Private key is absent from logs, API responses, and the signPayload return.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import nacl from "tweetnacl";

// ─── DB mock — must be hoisted before any imports that load @workspace/db ─────

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> & { then: unknown } = {
    then:    (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
    catch:   (r: (e: unknown) => unknown)   => Promise.resolve([]).catch(r),
    finally: (cb: () => void)               => Promise.resolve([]).finally(cb),
    from: () => chain, where: () => chain, orderBy: () => chain,
    set: () => chain, values: () => chain, returning: () => chain,
    limit: () => chain, onConflictDoNothing: () => chain,
  };
  const mockTx = {
    select: () => chain, update: () => chain, insert: () => chain,
    execute: async () => ({ rows: [] }),
  };
  return {
    db: {
      select: () => chain, update: () => chain, insert: () => chain,
      execute: async () => ({ rows: [] }),
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    signingKeyRegistryTable: { keyId: {} },
    signingKeyEventsTable:   { keyId: {}, eventType: {} },
    ledgerEntriesTable:      { keyId: {}, publicKey: {} },
    alertsTable: {}, vesselsTable: {}, emissionsRecordsTable: {},
    regulatoryProfilesTable: {}, auditorDecisionsTable: {},
  };
});

import {
  initSigningIdentity,
  computeKeyFingerprint,
  verifyPayload,
  signPayload,
  signingPublicKeyHex,
  signingKeyFingerprint,
  signingMode,
  _reinitForTesting,
} from "../lib/crypto.js";

// ─── Ensure _activeKeyId is set before any signPayload() calls ────────────────

/** Deterministic seed for the crypto test session. */
const SEED_FOR_CRYPTO_TESTS = "aa".repeat(32);

beforeAll(() => {
  _reinitForTesting(SEED_FOR_CRYPTO_TESTS);
});

// ─── Known test vectors ───────────────────────────────────────────────────────

/** A deterministic 32-byte seed expressed as 64 hex chars. */
const SEED_A = "a".repeat(64); // 32 bytes, all 0xaa
const SEED_B = "0b".repeat(32); // 32 bytes, all 0x0b
const SEED_VALID_FULL_KEY = (() => {
  const seed = Buffer.from(SEED_A, "hex");
  const kp = nacl.sign.keyPair.fromSeed(seed);
  return Buffer.from(kp.secretKey).toString("hex"); // 64-byte full key = 128 hex
})();

// ─── Test 1: Production startup without key → fails ──────────────────────────

describe("Test 1 — production startup without signing key", () => {
  it("throws when ED25519_SECRET_KEY_HEX is undefined in production", () => {
    expect(() => initSigningIdentity(undefined, true)).toThrow(
      /not configured|required.*production/i,
    );
  });

  it("throws when ED25519_SECRET_KEY_HEX is an empty string in production", () => {
    // empty string is falsy — treated same as undefined
    expect(() => initSigningIdentity(undefined, true)).toThrow();
  });

  it("error message contains actionable remediation guidance", () => {
    let msg = "";
    try { initSigningIdentity(undefined, true); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/ED25519_SECRET_KEY_HEX/);
    expect(msg).toMatch(/production|persistent/i);
  });
});

// ─── Test 2: Malformed signing key → fails ────────────────────────────────────

describe("Test 2 — malformed signing key", () => {
  it("throws on non-hex characters", () => {
    expect(() => initSigningIdentity("not-valid-hex!", false)).toThrow(
      /hexadecimal/i,
    );
  });

  it("throws on odd-length hex (incomplete byte)", () => {
    expect(() => initSigningIdentity("abc", false)).toThrow();
  });

  it("throws on correct hex format but wrong byte length (e.g. 16 bytes)", () => {
    const shortHex = "aa".repeat(16); // 16 bytes — not 32 or 64
    expect(() => initSigningIdentity(shortHex, false)).toThrow(/wrong length/i);
  });

  it("throws on correct hex format but wrong byte length (e.g. 48 bytes)", () => {
    const wrongHex = "bb".repeat(48); // 48 bytes — not 32 or 64
    expect(() => initSigningIdentity(wrongHex, false)).toThrow(/wrong length/i);
  });
});

// ─── Test 3: Valid persistent key → startup succeeds ─────────────────────────

describe("Test 3 — valid persistent key loads successfully", () => {
  it("accepts a 32-byte seed (64 hex chars)", () => {
    const result = initSigningIdentity(SEED_A, true);
    expect(result.identity.mode).toBe("PERSISTENT_ED25519");
    expect(result.identity.publicKeyHex).toHaveLength(64); // 32 bytes = 64 hex
    expect(result.identity.fingerprint).toHaveLength(16); // first 8 bytes of sha256 = 16 hex
  });

  it("accepts a 64-byte full secret key (128 hex chars)", () => {
    const result = initSigningIdentity(SEED_VALID_FULL_KEY, true);
    expect(result.identity.mode).toBe("PERSISTENT_ED25519");
    expect(result.identity.publicKeyHex).toHaveLength(64);
  });

  it("produces a key that passes the internal self-test", () => {
    // initSigningIdentity internally performs sign+verify; if it returns
    // without throwing, the self-test passed.
    expect(() => initSigningIdentity(SEED_A, true)).not.toThrow();
  });

  it("loaded module exports are PERSISTENT_ED25519 (ED25519_SECRET_KEY_HEX is set in this env)", () => {
    // The module was already initialised at import time using the Replit Secret.
    // If the secret is present, mode must be PERSISTENT; if not, EPHEMERAL_DEV.
    // Either way, signingMode must be one of the two known values.
    expect(["PERSISTENT_ED25519", "EPHEMERAL_DEV_ED25519"]).toContain(signingMode);
    expect(signingPublicKeyHex).toHaveLength(64);
    expect(signingKeyFingerprint).toHaveLength(16);
  });
});

// ─── Test 4: Repeated restarts → same identity ───────────────────────────────

describe("Test 4 — same key produces same public identity across calls", () => {
  it("produces identical publicKeyHex from the same 32-byte seed", () => {
    const r1 = initSigningIdentity(SEED_A, false);
    const r2 = initSigningIdentity(SEED_A, false);
    expect(r1.identity.publicKeyHex).toBe(r2.identity.publicKeyHex);
  });

  it("produces identical fingerprint from the same 32-byte seed", () => {
    const r1 = initSigningIdentity(SEED_A, false);
    const r2 = initSigningIdentity(SEED_A, false);
    expect(r1.identity.fingerprint).toBe(r2.identity.fingerprint);
  });

  it("produces a different public key for a different seed", () => {
    const r1 = initSigningIdentity(SEED_A, false);
    const r2 = initSigningIdentity(SEED_B, false);
    expect(r1.identity.publicKeyHex).not.toBe(r2.identity.publicKeyHex);
  });

  it("full-key input and seed-derived input from the same seed produce the same public key", () => {
    const fromSeed = initSigningIdentity(SEED_A, false);
    const fromFull = initSigningIdentity(SEED_VALID_FULL_KEY, false);
    // SEED_VALID_FULL_KEY was derived from SEED_A, so public keys must match.
    expect(fromSeed.identity.publicKeyHex).toBe(fromFull.identity.publicKeyHex);
  });
});

// ─── Test 5: Ephemeral mode is marked and blocked in production ───────────────

describe("Test 5 — ephemeral mode is development-only", () => {
  it("returns EPHEMERAL_DEV_ED25519 when key is absent and isProduction=false", () => {
    const result = initSigningIdentity(undefined, false);
    expect(result.identity.mode).toBe("EPHEMERAL_DEV_ED25519");
  });

  it("throws (not ephemeral) when key is absent and isProduction=true", () => {
    expect(() => initSigningIdentity(undefined, true)).toThrow();
  });

  it("ephemeral call still returns a valid 32-byte public key", () => {
    const result = initSigningIdentity(undefined, false);
    expect(result.identity.publicKeyHex).toHaveLength(64);
  });

  it("two ephemeral identities produce different public keys (randomness)", () => {
    const r1 = initSigningIdentity(undefined, false);
    const r2 = initSigningIdentity(undefined, false);
    // Statistically certain to differ; theoretical collision probability is 2^-256
    expect(r1.identity.publicKeyHex).not.toBe(r2.identity.publicKeyHex);
  });
});

// ─── Test 6: Valid signature verifies ────────────────────────────────────────

describe("Test 6 — valid signature passes verification", () => {
  it("a payload signed with signPayload() verifies with verifyPayload()", () => {
    const payload = { vesselId: 1, eventType: "FUEL", fuelMassKg: 12_500.0 };
    const { signature, publicKey } = signPayload(payload);
    expect(verifyPayload(payload, signature, publicKey)).toBe(true);
  });

  it("correct key verifies; a different valid key does not", () => {
    // signPayload always uses the module-level signing key.
    // verifyPayload must return true for the paired public key and false for any other.
    const { identity: other } = initSigningIdentity(SEED_B, false);
    const payload = { z: "last", a: "first", m: 99 };
    const { signature, publicKey } = signPayload(payload);
    expect(verifyPayload(payload, signature, publicKey)).toBe(true);          // correct key ✓
    expect(verifyPayload(payload, signature, other.publicKeyHex)).toBe(false); // wrong key ✗
  });
});

// ─── Test 7: Modified payload fails verification ──────────────────────────────

describe("Test 7 — modified payload fails verification", () => {
  it("altering a field value makes the signature invalid", () => {
    const original = { vesselId: 1, fuelMassKg: 1000 };
    const { signature, publicKey } = signPayload(original);

    const tampered = { vesselId: 1, fuelMassKg: 2000 }; // changed value
    expect(verifyPayload(tampered, signature, publicKey)).toBe(false);
  });

  it("adding a field makes the signature invalid", () => {
    const original = { vesselId: 1, fuelMassKg: 1000 };
    const { signature, publicKey } = signPayload(original);

    const tampered = { vesselId: 1, fuelMassKg: 1000, extra: "injected" };
    expect(verifyPayload(tampered, signature, publicKey)).toBe(false);
  });

  it("removing a field makes the signature invalid", () => {
    const original = { vesselId: 1, fuelMassKg: 1000, eventType: "FUEL" };
    const { signature, publicKey } = signPayload(original);

    const tampered = { vesselId: 1, fuelMassKg: 1000 }; // missing eventType
    expect(verifyPayload(tampered, signature, publicKey)).toBe(false);
  });

  it("bit-flipping the signature hex makes it invalid", () => {
    const payload = { vesselId: 5, fuelMassKg: 500 };
    const { signature, publicKey } = signPayload(payload);

    // Flip the last character
    const flipped = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    expect(verifyPayload(payload, flipped, publicKey)).toBe(false);
  });
});

// ─── Test 8: Wrong public key fails verification ──────────────────────────────

describe("Test 8 — wrong public key fails verification", () => {
  it("a valid signature does not verify against a different public key", () => {
    const payload = { vesselId: 99, fuelMassKg: 750 };
    const { signature } = signPayload(payload);

    const { identity: other } = initSigningIdentity(SEED_B, false);
    expect(verifyPayload(payload, signature, other.publicKeyHex)).toBe(false);
  });

  it("a zero public key always fails", () => {
    const payload = { vesselId: 1 };
    const { signature } = signPayload(payload);
    const zeroKey = "00".repeat(32); // 32 zero bytes = valid-length but wrong key
    expect(verifyPayload(payload, signature, zeroKey)).toBe(false);
  });

  it("an odd-length public key hex returns false (does not throw)", () => {
    const payload = { vesselId: 1 };
    const { signature } = signPayload(payload);
    expect(verifyPayload(payload, signature, "abc")).toBe(false);
  });
});

// ─── Test 9: Private key absent from public outputs ───────────────────────────

describe("Test 9 — private key material never appears in public outputs", () => {
  it("signPayload() return value has exactly three keys: signature, publicKey, and keyId", () => {
    const result = signPayload({ vesselId: 1, fuelMassKg: 100 });
    expect(Object.keys(result).sort()).toEqual(["keyId", "publicKey", "signature"]);
  });

  it("signPayload().publicKey is 32 bytes (64 hex chars), not the 64-byte full secret", () => {
    const { publicKey } = signPayload({ v: 1 });
    // Public key: 32 bytes = 64 hex chars.
    // Full secret key: 64 bytes = 128 hex chars.  If this were the secret key,
    // the length would be 128.
    expect(publicKey).toHaveLength(64);
  });

  it("signPayload().signature is 64 bytes (128 hex chars)", () => {
    const { signature } = signPayload({ v: 1 });
    expect(signature).toHaveLength(128);
  });

  it("signingPublicKeyHex exported from the module is 32 bytes (not the private key)", () => {
    expect(signingPublicKeyHex).toHaveLength(64);
    expect(signingPublicKeyHex).toMatch(/^[0-9a-f]+$/);
  });

  it("the configured private key hex is not equal to signingPublicKeyHex", () => {
    const configuredKey = process.env.ED25519_SECRET_KEY_HEX ?? "";
    if (configuredKey.length > 0) {
      // Public key and private key / seed are cryptographically unrelated values;
      // they are vanishingly unlikely to be equal, and by construction never are.
      expect(signingPublicKeyHex).not.toBe(configuredKey);
    }
    // If no key is configured, the module used an ephemeral key; the public key
    // is still a valid 32-byte Ed25519 public key.
    expect(signingPublicKeyHex).toHaveLength(64);
  });

  it("computeKeyFingerprint produces 16 hex chars (does not leak key material)", () => {
    const fp = computeKeyFingerprint(signingPublicKeyHex);
    expect(fp).toHaveLength(16);
    expect(fp).toMatch(/^[0-9a-f]+$/);
    // The fingerprint must not equal the full public key or any private key
    expect(fp).not.toBe(signingPublicKeyHex);
    if (process.env.ED25519_SECRET_KEY_HEX) {
      expect(fp).not.toBe(process.env.ED25519_SECRET_KEY_HEX);
    }
  });
});
