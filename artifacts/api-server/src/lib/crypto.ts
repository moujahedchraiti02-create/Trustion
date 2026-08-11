/**
 * Cryptographic primitives for S³V TRUSTION
 *
 * Signing identity model
 * ─────────────────────
 * Each ledger entry is Ed25519-signed at ingest time.  The public key is stored
 * alongside the entry so any verifier can independently confirm authenticity
 * without access to the server.
 *
 * Key lifecycle limitations (current implementation)
 * ────────────────────────────────────────────────────
 * • PERSISTENT mode (production): ED25519_SECRET_KEY_HEX is a 32-byte seed or
 *   64-byte secret key stored as a Replit Secret.  All instances in a scale-out
 *   deployment share the same key, so every entry carries the same public key.
 *
 * • EPHEMERAL mode (development / test only): a fresh key pair is generated
 *   per process.  Signatures from different sessions use different keys and are
 *   NOT cross-verifiable.  This mode must never be used in production or for
 *   regulatory audit.
 *
 * • Key rotation: the system does NOT currently automate key rotation.  Because
 *   each ledger entry stores the full public key used to sign it, entries signed
 *   under a retired key remain verifiable in perpetuity — the verifier uses the
 *   public key embedded in the entry, not the currently active server key.
 *   Manual rotation consists of provisioning a new ED25519_SECRET_KEY_HEX value
 *   and redeploying; entries before the rotation remain verifiable.
 *
 * • Key revocation: no revocation mechanism exists.  Compromise of
 *   ED25519_SECRET_KEY_HEX requires manual rotation and out-of-band notification
 *   to auditors to disregard entries signed after the compromise window.
 *
 * • TPM / HSM: this implementation is software-only.  No TPM or HSM integration
 *   exists.  Private key material lives in process memory for the duration of
 *   the server's lifetime.  "SOFTWARE_ED25519" in signerMode accurately reflects
 *   this; do not claim hardware-backed signing unless real HSM integration is added.
 */

import { createHash } from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { logger } from "./logger";

type Payload = Record<string, unknown>;

// ─── Stable serialisation ────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

// ─── Hex helpers ─────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const normalised = hex.trim().replace(/\s+/g, "").replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(normalised) || normalised.length % 2 !== 0) {
    throw new Error("Secret key must be an even-length hexadecimal string.");
  }
  return Uint8Array.from(normalised.match(/.{2}/g) ?? [], (b) => parseInt(b, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// ─── Key fingerprint ─────────────────────────────────────────────────────────

/**
 * Derive a compact, non-secret identifier for a public key.
 *
 * Returns the first 8 bytes (16 hex characters) of SHA-256(publicKeyHex).
 * This is safe to log and embed in API responses — it contains no private key
 * material and cannot be reversed to reconstruct the public key.
 *
 * Callers who need full auditability should use the complete publicKey stored
 * in each ledger entry, not the fingerprint.
 */
export function computeKeyFingerprint(publicKeyHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest("hex")
    .slice(0, 16);
}

// ─── Signing identity type ───────────────────────────────────────────────────

export type SigningMode = "PERSISTENT_ED25519" | "EPHEMERAL_DEV_ED25519";

export interface SigningIdentity {
  /** Hex-encoded Ed25519 public key (32 bytes / 64 hex chars). Non-secret. */
  readonly publicKeyHex: string;
  /**
   * Compact identifier for this signing identity (first 8 bytes of SHA-256
   * of the public key, 16 hex chars).  Safe to log and expose in APIs.
   */
  readonly fingerprint: string;
  /** Whether this is a persistent production key or an ephemeral dev key. */
  readonly mode: SigningMode;
}

// ─── Identity initialisation ─────────────────────────────────────────────────

/**
 * Initialise an Ed25519 signing identity from an optional hex-encoded secret.
 *
 * This function is exported so automated tests can call it directly with
 * controlled inputs without relying on process.env or module-level state.
 *
 * @param secretKeyHex  - Hex string of the 32-byte seed or 64-byte secret key,
 *                        or undefined if not configured.
 * @param isProduction  - When true, throws if secretKeyHex is absent.
 *                        When false, generates an ephemeral key with warnings.
 * @throws {Error}      - Missing key in production, malformed hex, wrong length,
 *                        or sign/verify self-test failure.
 */
export function initSigningIdentity(
  secretKeyHex: string | undefined,
  isProduction: boolean,
): { keyPair: nacl.SignKeyPair; identity: SigningIdentity } {
  if (secretKeyHex) {
    // ── Validate hex encoding ──────────────────────────────────────────────
    const secretKey = hexToBytes(secretKeyHex);

    if (
      secretKey.length !== nacl.sign.seedLength &&
      secretKey.length !== nacl.sign.secretKeyLength
    ) {
      throw new Error(
        `ED25519_SECRET_KEY_HEX has wrong length. ` +
          `Expected ${nacl.sign.seedLength} bytes (seed, 64 hex chars) or ` +
          `${nacl.sign.secretKeyLength} bytes (full secret key, 128 hex chars). ` +
          `Got ${secretKey.length} bytes (${secretKeyHex.length} hex chars).`,
      );
    }

    // ── Derive key pair ────────────────────────────────────────────────────
    const keyPair =
      secretKey.length === nacl.sign.seedLength
        ? nacl.sign.keyPair.fromSeed(secretKey)
        : nacl.sign.keyPair.fromSecretKey(secretKey);

    // ── Self-test: sign then verify a known message ────────────────────────
    // Confirms the key pair is internally consistent and usable before the
    // server begins accepting ledger ingest requests.
    const testMsg = naclUtil.decodeUTF8("S3V_TRUSTION_KEY_SELFTEST_v1");
    const testSig = nacl.sign.detached(testMsg, keyPair.secretKey);
    if (!nacl.sign.detached.verify(testMsg, testSig, keyPair.publicKey)) {
      throw new Error(
        "Ed25519 signing key self-test failed: the produced signature does not " +
          "verify against the derived public key. The key pair is unusable.",
      );
    }

    const publicKeyHex = bytesToHex(keyPair.publicKey);
    const fingerprint = computeKeyFingerprint(publicKeyHex);

    // Log identity metadata — NEVER log secretKeyHex or any derived key bytes.
    logger.info(
      { signingMode: "PERSISTENT_ED25519", keyFingerprint: fingerprint },
      "Ed25519 persistent signing identity loaded and verified.",
    );

    return {
      keyPair,
      identity: { publicKeyHex, fingerprint, mode: "PERSISTENT_ED25519" },
    };
  }

  // ── No key configured ─────────────────────────────────────────────────────
  if (isProduction) {
    throw new Error(
      "[FATAL] ED25519_SECRET_KEY_HEX is not configured. " +
        "A persistent Ed25519 signing key is required in production to ensure " +
        "that ledger entries remain verifiable across restarts, redeployments, " +
        "and scale-out instances. " +
        "Generate a 32-byte seed (64 hex chars) with: " +
        "node -e \"const {sign}=require('tweetnacl');" +
        "process.stdout.write(Buffer.from(sign.keyPair().secretKey.slice(0,32)).toString('hex')+'\\n')\" " +
        "and set it as the ED25519_SECRET_KEY_HEX Replit Secret before deploying.",
    );
  }

  // ── Ephemeral key — development / test only ───────────────────────────────
  const keyPair = nacl.sign.keyPair();
  const publicKeyHex = bytesToHex(keyPair.publicKey);
  const fingerprint = computeKeyFingerprint(publicKeyHex);

  // Emit a prominent warning so developers never mistake this for production.
  logger.warn(
    {
      signingMode: "EPHEMERAL_DEV_ED25519",
      keyFingerprint: fingerprint,
      WARNING: "NON-PERSISTENT / NON-PRODUCTION",
    },
    "[NON-PERSISTENT / NON-PRODUCTION] Ed25519 signing identity is EPHEMERAL. " +
      "Signatures from this session CANNOT be verified after a server restart. " +
      "Historical entries signed under a different ephemeral key will fail " +
      "signature verification. " +
      "Set ED25519_SECRET_KEY_HEX before production use or regulatory audit.",
  );

  return {
    keyPair,
    identity: { publicKeyHex, fingerprint, mode: "EPHEMERAL_DEV_ED25519" },
  };
}

// ─── Module-level signing identity ───────────────────────────────────────────
// Initialised once at startup.  Throws immediately if in production and the
// key is absent, malformed, or fails the self-test.

const {
  keyPair: _signingKeyPair,
  identity: _signingIdentity,
} = initSigningIdentity(
  process.env.ED25519_SECRET_KEY_HEX,
  process.env.NODE_ENV === "production",
);

/**
 * Hex-encoded Ed25519 public key for the current signing identity.
 * Safe to include in API responses and logs.
 */
export const signingPublicKeyHex: string = _signingIdentity.publicKeyHex;

/**
 * Compact fingerprint (first 8 bytes of SHA-256(publicKey) as hex).
 * Use this to identify which key signed a given set of entries without
 * exposing the full public key.
 */
export const signingKeyFingerprint: string = _signingIdentity.fingerprint;

/**
 * Signing mode for the current identity.
 * PERSISTENT_ED25519 = configured via ED25519_SECRET_KEY_HEX (production-safe).
 * EPHEMERAL_DEV_ED25519 = per-process ephemeral key (development/test only).
 */
export const signingMode: SigningMode = _signingIdentity.mode;

// ─── Payload helpers ─────────────────────────────────────────────────────────

function payloadBytes(payload: Payload): Uint8Array {
  return naclUtil.decodeUTF8(stableStringify(payload));
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Sign a payload with the server's current Ed25519 signing identity.
 *
 * Returns the hex-encoded detached signature and the hex-encoded public key.
 * The public key is stored in the ledger entry so historical records remain
 * verifiable even after key rotation (the verifier uses the stored key, not
 * the current server key).
 *
 * Private key material is never included in the return value.
 */
export function signPayload(payload: Payload): {
  signature: string;
  publicKey: string;
} {
  return {
    signature: bytesToHex(
      nacl.sign.detached(payloadBytes(payload), _signingKeyPair.secretKey),
    ),
    publicKey: bytesToHex(_signingKeyPair.publicKey),
  };
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * Verify a detached Ed25519 signature against a payload and public key.
 *
 * Always uses the public key embedded in the ledger entry, NOT the current
 * server signing key.  This means verification works correctly for entries
 * signed under a previous key (before rotation) and for entries signed by a
 * different server instance.
 */
export function verifyPayload(
  payload: Payload,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    if (
      signature.length !== nacl.sign.signatureLength ||
      publicKey.length !== nacl.sign.publicKeyLength
    ) {
      return false;
    }
    return nacl.sign.detached.verify(payloadBytes(payload), signature, publicKey);
  } catch {
    return false;
  }
}

// ─── Hash functions ───────────────────────────────────────────────────────────

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeRawHash(data: Record<string, unknown>): string {
  return sha256(JSON.stringify(data));
}

export function computeChainHash(rawHash: string, prevHash: string | null): string {
  return sha256(`${rawHash}:${prevHash ?? "GENESIS"}`);
}

export function buildMerkleProof(
  entries: { chainHash: string }[],
  targetIndex: number,
): string[] {
  if (entries.length === 0) return [];
  const hashes = entries.map((e) => e.chainHash);
  const proof: string[] = [];
  let idx = targetIndex;
  let levelHashes = [...hashes];

  while (levelHashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < levelHashes.length; i += 2) {
      const left = levelHashes[i];
      const right = levelHashes[i + 1] ?? left;
      next.push(sha256(`${left}${right}`));
    }
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (siblingIdx < levelHashes.length) {
      proof.push(levelHashes[siblingIdx]);
    }
    idx = Math.floor(idx / 2);
    levelHashes = next;
  }
  return proof;
}
