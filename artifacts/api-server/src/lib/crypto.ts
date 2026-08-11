/**
 * Cryptographic primitives for S³V TRUSTION
 *
 * Signing identity and key lifecycle model
 * ─────────────────────────────────────────
 * Each ledger entry is Ed25519-signed at ingest time.  The public key AND its
 * stable key_id are stored alongside the entry so any verifier can:
 *   (a) confirm the signature using the stored public key; and
 *   (b) look up the key lifecycle status (ACTIVE / RETIRED / REVOKED) in the
 *       signing key registry.
 *
 * Key ID
 * ──────
 * key_id = SHA-256(publicKey bytes) as 64 lowercase hex chars.  Computed by
 * computeKeyId().  It is NOT the fingerprint; the fingerprint is only the
 * first 16 hex chars of the same hash.
 *
 * Rotation model
 * ──────────────
 * At most one signing key may be ACTIVE at any time.  Rotation:
 *   1. Validates the new key (hex format, byte length, sign/verify self-test).
 *   2. Retires the current ACTIVE key in the registry.
 *   3. Registers and activates the new key.
 *   4. Updates the module-level key pair used by signPayload().
 * Old entries remain associated with their original key_id permanently.
 * verifyPayload() and verifyPayloadByKeyId() continue to work for all
 * historical keys regardless of how many rotations have occurred.
 *
 * Key lifecycle limitations (current implementation)
 * ────────────────────────────────────────────────────
 * • PERSISTENT mode (production): ED25519_SECRET_KEY_HEX is a 32-byte seed or
 *   64-byte secret key stored as a Replit Secret.  After rotation via the API
 *   endpoint, the new key is active IN MEMORY only.  For persistence across
 *   restarts, ED25519_SECRET_KEY_HEX must also be updated before the next
 *   restart — the server will otherwise reload the env key and auto-retire any
 *   DB-ACTIVE key that differs.
 *
 * • EPHEMERAL mode (development / test only): a fresh key pair is generated
 *   per process.  This mode must never be used in production or for regulatory
 *   audit.
 *
 * • No automated rotation scheduler — rotation is manual via the
 *   POST /api/key-registry/rotate endpoint (ADMIN role required) or by
 *   updating ED25519_SECRET_KEY_HEX and restarting.
 *
 * • No revocation list distribution — revoking a key updates the database
 *   registry; auditors must query the registry to see revocation status.
 *
 * • No TPM / HSM backing — private key material lives in process memory.
 *   "SOFTWARE_ED25519" in signerMode accurately reflects this; do not claim
 *   hardware-backed signing unless real HSM integration is added.
 *
 * • No cross-instance registry sync beyond the shared PostgreSQL database.
 */

import { createHash } from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { logger } from "./logger.js";
import {
  computeKeyId,
  registerKey,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  getKeyById,
  listKeys,
  initRegistry,
  _clearRegistryForTesting,
} from "./keyRegistry.js";

// Re-export registry read/init helpers so callers only import from crypto.
export {
  computeKeyId,
  getKeyById,
  listKeys,
  initRegistry,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  _clearRegistryForTesting,
};
export type { KeyRegistryEntry, KeyStatus } from "./keyRegistry.js";

type Payload = Record<string, unknown>;
type SigningMode = "PERSISTENT_ED25519" | "EPHEMERAL_DEV_ED25519";

interface SigningIdentity {
  readonly publicKeyHex: string;
  readonly fingerprint: string;
  readonly mode: SigningMode;
}

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
 * Use computeKeyId() for the full 32-byte (64 hex char) stable key identifier.
 */
export function computeKeyFingerprint(publicKeyHex: string): string {
  return createHash("sha256")
    .update(Buffer.from(publicKeyHex, "hex"))
    .digest("hex")
    .slice(0, 16);
}

// ─── Identity initialisation ─────────────────────────────────────────────────

/**
 * Initialise an Ed25519 signing identity from an optional hex-encoded secret.
 * Exported for test isolation — tests call this directly with controlled inputs.
 */
export function initSigningIdentity(
  secretKeyHex: string | undefined,
  isProduction: boolean,
): { keyPair: nacl.SignKeyPair; identity: SigningIdentity } {
  if (secretKeyHex) {
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

    const keyPair =
      secretKey.length === nacl.sign.seedLength
        ? nacl.sign.keyPair.fromSeed(secretKey)
        : nacl.sign.keyPair.fromSecretKey(secretKey);

    // Self-test: sign then verify a known message.
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

    // NEVER log secretKeyHex or derived key bytes — fingerprint only.
    logger.info(
      { signingMode: "PERSISTENT_ED25519", keyFingerprint: fingerprint },
      "Ed25519 persistent signing identity loaded and verified.",
    );

    return {
      keyPair,
      identity: { publicKeyHex, fingerprint, mode: "PERSISTENT_ED25519" },
    };
  }

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

  // Ephemeral key — development / test only.
  const keyPair = nacl.sign.keyPair();
  const publicKeyHex = bytesToHex(keyPair.publicKey);
  const fingerprint = computeKeyFingerprint(publicKeyHex);

  logger.warn(
    {
      signingMode: "EPHEMERAL_DEV_ED25519",
      keyFingerprint: fingerprint,
      WARNING: "NON-PERSISTENT / NON-PRODUCTION",
    },
    "[NON-PERSISTENT / NON-PRODUCTION] Ed25519 signing identity is EPHEMERAL. " +
      "Signatures from this session CANNOT be verified after a server restart. " +
      "Set ED25519_SECRET_KEY_HEX before production use or regulatory audit.",
  );

  return {
    keyPair,
    identity: { publicKeyHex, fingerprint, mode: "EPHEMERAL_DEV_ED25519" },
  };
}

// ─── Module-level mutable signing state ──────────────────────────────────────
// Initialised once at startup; updated by rotateSigningKey().

let _signingKeyPair: nacl.SignKeyPair;
let _signingIdentity: SigningIdentity;
let _activeKeyId: string | null = null;

{
  const { keyPair, identity } = initSigningIdentity(
    process.env.ED25519_SECRET_KEY_HEX,
    process.env.NODE_ENV === "production",
  );
  _signingKeyPair = keyPair;
  _signingIdentity = identity;

  // Register in the in-memory registry (synchronous; DB persistence is async).
  _activeKeyId = registerKey(identity.publicKeyHex, identity.fingerprint, identity.mode);
}

// ─── Stable exports (reflect startup identity; use getActiveKeyId() for current) ──

/**
 * Hex-encoded public key for the signing identity active at startup.
 * After rotation, the current key can differ — use signPayload().publicKey.
 */
export const signingPublicKeyHex: string = _signingIdentity.publicKeyHex;

/**
 * Fingerprint for the signing identity active at startup.
 * After rotation, use getKeyById(getActiveKeyId()).fingerprint.
 */
export const signingKeyFingerprint: string = _signingIdentity.fingerprint;

/**
 * Signing mode active at startup (PERSISTENT_ED25519 or EPHEMERAL_DEV_ED25519).
 */
export const signingMode: SigningMode = _signingIdentity.mode;

/** key_id of the currently active signing key; null if the key was revoked. */
export function getActiveKeyId(): string | null {
  return _activeKeyId;
}

// ─── Payload helpers ─────────────────────────────────────────────────────────

function payloadBytes(payload: Payload): Uint8Array {
  return naclUtil.decodeUTF8(stableStringify(payload));
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * Sign a payload with the currently active Ed25519 signing identity.
 *
 * Returns the hex-encoded detached signature, the hex-encoded public key,
 * and the key_id.  The public key and key_id are stored in ledger entries so
 * historical records remain verifiable after rotation — verifiers use the
 * stored public key, not the current server key.
 *
 * Throws if no key is currently ACTIVE (e.g. after revocation without rotation).
 * Private key material is never included in the return value.
 */
export function signPayload(payload: Payload): {
  signature: string;
  publicKey: string;
  keyId: string;
} {
  if (!_activeKeyId) {
    throw new Error(
      "No active signing key. The signing key may have been revoked without a " +
        "replacement. Rotate in a new key before ingesting ledger evidence.",
    );
  }
  const entry = getKeyById(_activeKeyId);
  if (!entry || entry.status !== "ACTIVE") {
    throw new Error(
      `Signing key ${_activeKeyId} is not ACTIVE ` +
        `(status: ${entry?.status ?? "not found in registry"}). ` +
        "Cannot create new evidence signatures. Rotate in a replacement key.",
    );
  }
  return {
    signature: bytesToHex(
      nacl.sign.detached(payloadBytes(payload), _signingKeyPair.secretKey),
    ),
    publicKey: bytesToHex(_signingKeyPair.publicKey),
    keyId: _activeKeyId,
  };
}

// ─── Key rotation ─────────────────────────────────────────────────────────────

/**
 * Rotate the active signing key to a new key derived from newSecretKeyHex.
 *
 * Steps:
 *   1. Validate the new key (hex format, byte length, self-test).
 *   2. Retire the current ACTIVE key in the registry.
 *   3. Register and activate the new key in the registry.
 *   4. Update module-level state so signPayload() uses the new key.
 *
 * Returns the key_id of the newly activated key.
 *
 * NOTE: For persistence across restarts, also update ED25519_SECRET_KEY_HEX
 * in the deployment environment.  If the server restarts without that update,
 * the env key is loaded as a new key and the in-memory rotation is lost
 * (though the registry DB retains the full history).
 */
export function rotateSigningKey(newSecretKeyHex: string): string {
  const { keyPair: newPair, identity: newId } = initSigningIdentity(
    newSecretKeyHex,
    false, // rotation call — never production-mode check
  );
  const newKeyId = computeKeyId(newId.publicKeyHex);

  // Retire the current active key if it is different.
  if (_activeKeyId && _activeKeyId !== newKeyId) {
    const current = getKeyById(_activeKeyId);
    if (current && current.status === "ACTIVE") {
      retireKeyInRegistry(_activeKeyId);
    }
  }

  // Register (or re-activate if previously retired) the new key.
  const keyId = registerKey(newId.publicKeyHex, newId.fingerprint, newId.mode);

  // Update module-level state.
  _signingKeyPair = newPair;
  _signingIdentity = newId;
  _activeKeyId = keyId;

  logger.info(
    { newKeyId: keyId, fingerprint: newId.fingerprint, rotatedFrom: _activeKeyId },
    "Signing key rotated.",
  );

  return keyId;
}

/**
 * Revoke the currently active signing key.
 *
 * After revocation:
 *   • signPayload() throws — no new evidence can be signed.
 *   • verifyPayload() and verifyPayloadByKeyId() still work for historical
 *     records (revocation preserves history, it does not delete it).
 *   • The registry entry retains the revocation reason for audit.
 *
 * Callers MUST rotate in a new key before the server can sign again.
 */
export function revokeCurrentSigningKey(reason: string): void {
  if (!_activeKeyId) {
    throw new Error("No active signing key to revoke.");
  }
  const entry = getKeyById(_activeKeyId);
  if (!entry) {
    throw new Error(`Active key ${_activeKeyId} not found in registry — cannot revoke.`);
  }
  revokeKeyInRegistry(_activeKeyId, reason);
  _activeKeyId = null; // prevents further signing until rotation
  logger.warn(
    { reason },
    "Signing key revoked. Server cannot sign new evidence until a replacement key is rotated in.",
  );
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Reset signing state to a known key for test isolation.
 *
 * Clears the in-memory registry and re-initialises with the given key hex.
 * The new key is registered as ACTIVE.  NOT for production use.
 */
export function _reinitForTesting(keyHex: string): string {
  _clearRegistryForTesting();
  const { keyPair, identity } = initSigningIdentity(keyHex, false);
  const keyId = registerKey(identity.publicKeyHex, identity.fingerprint, identity.mode);
  _signingKeyPair = keyPair;
  _signingIdentity = identity;
  _activeKeyId = keyId;
  return keyId;
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a detached Ed25519 signature against a payload and public key.
 *
 * Always uses the explicit publicKeyHex argument — NOT the current server key.
 * This means verification works for any historical key regardless of rotation.
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

/**
 * Verify a signature by resolving the public key from the signing key registry.
 *
 * Returns false (fails closed) if:
 *   • keyId is not in the registry (unknown key).
 *   • The registry entry has malformed or missing public key data.
 *   • The signature is cryptographically invalid.
 *
 * Note on status: RETIRED and REVOKED keys can still verify signatures that
 * were legitimately created while the key was ACTIVE.  Callers that want to
 * reject REVOKED-key signatures must check getKeyById(keyId).status separately.
 */
export function verifyPayloadByKeyId(
  payload: Payload,
  signatureHex: string,
  keyId: string,
): boolean {
  const entry = getKeyById(keyId);
  if (!entry) return false; // unknown key — fail closed (req 10)
  if (!entry.publicKey || entry.publicKey.length !== 64) return false; // malformed (req 11)
  return verifyPayload(payload, signatureHex, entry.publicKey);
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
