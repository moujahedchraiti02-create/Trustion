import { createHash } from "crypto";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { logger } from "./logger";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type Payload = Record<string, unknown>;

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

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Secret key must be an even-length hexadecimal string.");
  }

  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

const configuredSecretKey = process.env.ED25519_SECRET_KEY_HEX;
const signingKeyPair = configuredSecretKey
  ? (() => {
      const secretKey = hexToBytes(configuredSecretKey);
      if (secretKey.length !== nacl.sign.secretKeyLength && secretKey.length !== nacl.sign.seedLength) {
        throw new Error(
          `ED25519_SECRET_KEY_HEX must be ${nacl.sign.seedLength} bytes (seed) or ${nacl.sign.secretKeyLength} bytes (secret key).`,
        );
      }
      return secretKey.length === nacl.sign.seedLength
        ? nacl.sign.keyPair.fromSeed(secretKey)
        : nacl.sign.keyPair.fromSecretKey(secretKey);
    })()
  : (() => {
      logger.warn(
        "ED25519_SECRET_KEY_HEX is not configured; using a temporary process-local Ed25519 key. This is NOT suitable for production or regulatory audit.",
      );
      return nacl.sign.keyPair();
    })();

function payloadBytes(payload: Payload): Uint8Array {
  return naclUtil.decodeUTF8(stableStringify(payload));
}

export function signPayload(payload: Payload, secretKeyHex?: string): {
  signature: string;
  publicKey: string;
} {
  const keyPair = secretKeyHex
    ? (() => {
        const secretKey = hexToBytes(secretKeyHex);
        if (secretKey.length !== nacl.sign.secretKeyLength && secretKey.length !== nacl.sign.seedLength) {
          throw new Error(
            `Secret key must be ${nacl.sign.seedLength} bytes (seed) or ${nacl.sign.secretKeyLength} bytes (secret key).`,
          );
        }
        return secretKey.length === nacl.sign.seedLength
          ? nacl.sign.keyPair.fromSeed(secretKey)
          : nacl.sign.keyPair.fromSecretKey(secretKey);
      })()
    : signingKeyPair;

  return {
    signature: bytesToHex(nacl.sign.detached(payloadBytes(payload), keyPair.secretKey)),
    publicKey: bytesToHex(keyPair.publicKey),
  };
}

export function verifyPayload(payload: Payload, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const signature = hexToBytes(signatureHex);
    const publicKey = hexToBytes(publicKeyHex);
    if (signature.length !== nacl.sign.signatureLength || publicKey.length !== nacl.sign.publicKeyLength) {
      return false;
    }
    return nacl.sign.detached.verify(payloadBytes(payload), signature, publicKey);
  } catch {
    return false;
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeRawHash(data: Record<string, unknown>): string {
  return sha256(JSON.stringify(data));
}

export function computeChainHash(rawHash: string, prevHash: string | null): string {
  return sha256(`${rawHash}:${prevHash ?? "GENESIS"}`);
}

export function buildMerkleProof(entries: { chainHash: string }[], targetIndex: number): string[] {
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
