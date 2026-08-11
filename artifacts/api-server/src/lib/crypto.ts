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
 * Rotation workflow (staged — restart required)
 * ──────────────────────────────────────────────
 * Zero-downtime key rotation is not supported in this prototype.  The correct
 * rotation procedure is:
 *
 *   1. Generate a new 32-byte Ed25519 seed offline:
 *      node -e "const {sign}=require('tweetnacl');
 *        process.stdout.write(Buffer.from(sign.keyPair().secretKey.slice(0,32)).toString('hex')+'\\n')"
 *
 *   2. Update the ED25519_SECRET_KEY_HEX Replit Secret.
 *
 *   3. Restart the server.
 *
 *   4. On startup, initRegistryAndActivate() detects the new key, atomically
 *      retires the previous ACTIVE key, and activates the new one — all
 *      within a single DB transaction that completes BEFORE the HTTP server
 *      begins accepting requests.
 *
 * No API endpoint ever accepts or touches private key material.
 *
 * Key lifecycle limitations
 * ──────────────────────────
 * • PERSISTENT mode (production): ED25519_SECRET_KEY_HEX is a Replit Secret.
 * • EPHEMERAL mode (development / test only): a fresh key pair is generated
 *   per process.  Do not use in production or for regulatory audit.
 * • No automated rotation scheduler.
 * • No cross-instance registry sync beyond the shared PostgreSQL database.
 * • No TPM / HSM — private key material lives in process memory.
 *   "SOFTWARE_ED25519" accurately describes this; do not claim hardware-backed.
 */

import { createHash } from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { logger } from "./logger.js";
import {
  computeKeyId,
  getKeyById,
  listKeys,
  listKeyEvents,
  checkSignatureContext,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  initRegistryAndActivate,
  _clearRegistryForTesting,
  _setRegistryEntryForTesting,
  _retireKeyInMemoryForTesting,
  _loadRegistryFromDb,
} from "./keyRegistry.js";

// Re-export for callers that only import from crypto.
export {
  computeKeyId,
  getKeyById,
  listKeys,
  listKeyEvents,
  checkSignatureContext,
  retireKeyInRegistry,
  revokeKeyInRegistry,
  initRegistryAndActivate,
  _clearRegistryForTesting,
  _setRegistryEntryForTesting,
  _retireKeyInMemoryForTesting,
  _loadRegistryFromDb,
};
export type {
  KeyRegistryEntry,
  KeyStatus,
  KeyEvent,
  KeyEventType,
  SignatureContext,
} from "./keyRegistry.js";

type Payload = Record<string, unknown>;
type SigningMode = "PERSISTENT_ED25519" | "EPHEMERAL_DEV_ED25519";

interface SigningIdentity {
  readonly publicKeyHex: string;
  readonly fingerprint: string;
  readonly mode: SigningMode;
}

// ─── Stable JSON serialisation ────────────────────────────────────────────────

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
 * Compact, non-secret identifier for a public key.
 * Returns the first 8 bytes (16 hex chars) of SHA-256(publicKeyHex).
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
 * Exported for test isolation.
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

    // NEVER log secretKeyHex or key bytes — fingerprint only.
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
// Populated at startup; never mutated via API (no rotateSigningKey).
// Only _reinitForTesting() may mutate this state, and only in test environments.

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
  // _activeKeyId is set by initRegistryAndActivate() at startup (src/index.ts).
  // It is not set here to enforce the "no signing before registry is ready" invariant.
}

// ─── Stable startup-time exports ─────────────────────────────────────────────

/** Hex-encoded public key for the env-configured signing identity. */
export const signingPublicKeyHex: string = _signingIdentity.publicKeyHex;

/** Fingerprint (first 16 hex chars of SHA-256(pubKey)) for the env-configured identity. */
export const signingKeyFingerprint: string = _signingIdentity.fingerprint;

/** Signing mode for the env-configured identity. */
export const signingMode: SigningMode = _signingIdentity.mode;

/** Current active key_id (set by initRegistryAndActivate; null before startup). */
export function getActiveKeyId(): string | null {
  return _activeKeyId;
}

/** Called by initRegistryAndActivate to set the active key_id after DB commit. */
export function _setActiveKeyId(keyId: string | null): void {
  _activeKeyId = keyId;
}

// ─── Signing ─────────────────────────────────────────────────────────────────

function payloadBytes(payload: Payload): Uint8Array {
  return naclUtil.decodeUTF8(stableStringify(payload));
}

/**
 * Sign a payload with the currently active Ed25519 signing identity.
 *
 * Returns { signature, publicKey, keyId }.  All three are stored in ledger
 * entries so historical records remain verifiable after rotation.
 *
 * Throws if the registry has not been initialised (initRegistryAndActivate not
 * yet called), if no key is ACTIVE, or if the active key's DB status is not
 * ACTIVE (e.g. after revocation without replacement).
 *
 * Private key material is never included in the return value.
 */
export function signPayload(payload: Payload): {
  signature: string;
  publicKey: string;
  keyId: string;
} {
  if (_activeKeyId === null) {
    throw new Error(
      "Signing is not available: the signing key registry has not been " +
        "initialised, or the active signing key has been revoked without a " +
        "replacement. Server startup requires initRegistryAndActivate() to " +
        "complete before any evidence can be signed.",
    );
  }

  const entry = getKeyById(_activeKeyId);
  if (!entry || entry.status !== "ACTIVE") {
    throw new Error(
      `Signing key ${_activeKeyId} is not ACTIVE ` +
        `(status: ${entry?.status ?? "not found in registry"}). ` +
        "Rotate in a replacement key via the env var + restart workflow.",
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

// ─── Revocation (clears active key, then delegates to registry) ──────────────

/**
 * Revoke the currently active signing key.
 *
 * After revocation, signPayload() throws until the server is restarted with a
 * new ED25519_SECRET_KEY_HEX.  Historical records remain verifiable.
 *
 * actor must be the authenticated caller's subject (from req.auth.subject).
 */
export async function revokeCurrentSigningKey(reason: string, actor: string): Promise<void> {
  if (!_activeKeyId) {
    throw new Error("No active signing key to revoke.");
  }
  const keyId = _activeKeyId;

  // Persist revocation to DB (transactional, fail-closed) BEFORE clearing
  // the in-memory active key — if the DB write fails, signing continues and
  // the operator can retry.
  await revokeKeyInRegistry(keyId, reason, actor);

  // Only clear the in-memory pointer after the DB transaction commits.
  _activeKeyId = null;

  logger.warn(
    { keyId, actor, reason },
    "Active signing key revoked. Server cannot sign new evidence until " +
      "ED25519_SECRET_KEY_HEX is updated with a replacement key and the server is restarted.",
  );
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a detached Ed25519 signature against a payload and public key.
 * Always uses the explicit publicKeyHex argument, not the current server key.
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
 * Returns false (fails closed) for unknown key, malformed key data, or invalid sig.
 *
 * Callers that also need lifecycle status (RETIRED / REVOKED / UNKNOWN) should
 * use checkSignatureContext() instead — it provides revokedAt and lets auditors
 * determine whether a signature predates the revocation.
 */
export function verifyPayloadByKeyId(
  payload: Payload,
  signatureHex: string,
  keyId: string,
): boolean {
  const entry = getKeyById(keyId);
  if (!entry) return false;
  if (!entry.publicKey || entry.publicKey.length !== 64) return false;
  return verifyPayload(payload, signatureHex, entry.publicKey);
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Reset module-level signing state to a known key for test isolation.
 * Clears the in-memory registry and registers a specific key as ACTIVE
 * WITHOUT touching the database.  NOT for production use.
 */
export function _reinitForTesting(keyHex: string): string {
  _clearRegistryForTesting();
  const { keyPair, identity } = initSigningIdentity(keyHex, false);
  const keyId = computeKeyId(identity.publicKeyHex);

  _setRegistryEntryForTesting({
    keyId,
    publicKey: identity.publicKeyHex,
    fingerprint: identity.fingerprint,
    algorithm: "Ed25519",
    signingMode: identity.mode,
    status: "ACTIVE",
    activatedAt: new Date(),
    retiredAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date(),
  });

  _signingKeyPair = keyPair;
  _signingIdentity = identity;
  _activeKeyId = keyId;
  return keyId;
}

/**
 * Simulate a restart with a new signing key for test scenarios that test
 * historical verification across multiple key generations.  Unlike
 * _reinitForTesting(), this PRESERVES existing registry entries (simulating
 * DB persistence) and RETIRES the current ACTIVE key before activating the new one.
 * Does NOT touch the database.  NOT for production use.
 */
export function _simulateRotationForTesting(newKeyHex: string): string {
  // Retire current active key in memory.
  if (_activeKeyId) {
    _retireKeyInMemoryForTesting(_activeKeyId);
    _activeKeyId = null;
  }

  const { keyPair, identity } = initSigningIdentity(newKeyHex, false);
  const keyId = computeKeyId(identity.publicKeyHex);

  _setRegistryEntryForTesting({
    keyId,
    publicKey: identity.publicKeyHex,
    fingerprint: identity.fingerprint,
    algorithm: "Ed25519",
    signingMode: identity.mode,
    status: "ACTIVE",
    activatedAt: new Date(),
    retiredAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date(),
  });

  _signingKeyPair = keyPair;
  _signingIdentity = identity;
  _activeKeyId = keyId;
  return keyId;
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

// ─── Epoch Merkle functions ───────────────────────────────────────────────────

/**
 * Compute the Merkle root of an ordered set of ledger entries.
 *
 * Algorithm (same as buildMerkleProof):
 *   leaf[i]  = entries[i].chainHash                     (must be 64-char SHA-256 hex)
 *   parent   = SHA-256(left_hex || right_hex)           (string concatenation)
 *   odd node = last node is paired with a duplicate of itself
 *
 * Returns null for an empty list.
 */
export function computeMerkleRoot(entries: { chainHash: string }[]): string | null {
  if (entries.length === 0) return null;
  let hashes = entries.map((e) => e.chainHash);
  while (hashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] ?? left; // duplicate last node when odd count
      next.push(sha256(`${left}${right}`));
    }
    hashes = next;
  }
  return hashes[0];
}

/**
 * Build a Merkle inclusion proof with sibling direction for independent verification.
 *
 * Returns an ordered array of proof steps.  Each step:
 *   sibling:   the sibling node hash at that tree level
 *   direction: "right" → sibling is to the right of the current node
 *              "left"  → sibling is to the left  of the current node
 *
 * Reconstruction (apply each step left→right, starting from the leaf):
 *   direction === "right": current = SHA-256(current + sibling)
 *   direction === "left":  current = SHA-256(sibling + current)
 * Final result must equal the stored Merkle root.
 *
 * Returns [] for a single-entry epoch; the leaf itself is the root, and the
 * empty proof still validates via verifyMerkleProof.
 */
export function buildMerkleProofWithDirection(
  entries: { chainHash: string }[],
  targetIndex: number,
): { sibling: string; direction: "left" | "right" }[] {
  if (entries.length === 0) return [];
  const proof: { sibling: string; direction: "left" | "right" }[] = [];
  let idx = targetIndex;
  let levelHashes = entries.map((e) => e.chainHash);

  while (levelHashes.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < levelHashes.length; i += 2) {
      const left = levelHashes[i];
      const right = levelHashes[i + 1] ?? left;
      next.push(sha256(`${left}${right}`));
    }
    // idx even → target is a left child; its sibling is to the right.
    // idx odd  → target is a right child; its sibling is to the left.
    const direction: "left" | "right" = idx % 2 === 0 ? "right" : "left";
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;

    if (siblingIdx < levelHashes.length) {
      proof.push({ sibling: levelHashes[siblingIdx], direction });
    } else {
      // Target was an odd last node — paired with a duplicate of itself.
      proof.push({ sibling: levelHashes[idx], direction: "right" });
    }

    idx = Math.floor(idx / 2);
    levelHashes = next;
  }
  return proof;
}

/**
 * Verify a Merkle inclusion proof produced by buildMerkleProofWithDirection.
 *
 * @param leaf       chainHash of the entry being proved.
 * @param proof      proof path returned by buildMerkleProofWithDirection.
 * @param merkleRoot stored Merkle root of the closed epoch.
 * @returns true if the proof is valid (leaf is a member at the expected position).
 */
export function verifyMerkleProof(
  leaf: string,
  proof: { sibling: string; direction: "left" | "right" }[],
  merkleRoot: string,
): boolean {
  let current = leaf;
  for (const step of proof) {
    current =
      step.direction === "right"
        ? sha256(`${current}${step.sibling}`)
        : sha256(`${step.sibling}${current}`);
  }
  return current === merkleRoot;
}
