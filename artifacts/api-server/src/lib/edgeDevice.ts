/**
 * Edge device registry operations — S³V TRUSTION
 *
 * All mutations are transactionally safe.  Private key material is never
 * accepted, stored, or passed through any function in this module.
 *
 * Canonical source-signed payload format
 * ───────────────────────────────────────
 * The device must sign the following payload using Ed25519 before submitting:
 *
 *   stableJsonStringify({
 *     deviceId:             string   // UUID assigned at registration
 *     deviceSequenceNumber: number   // monotonic integer
 *     engineLoadPct:        number
 *     eventType:            string
 *     fuelMassKg:           number
 *     fuelType:             string
 *     positionLat:          number | null
 *     positionLon:          number | null
 *     timestampDevice:      string | null  // ISO 8601
 *     timestampGnss:        string         // ISO 8601
 *     vesselId:             number
 *   })
 *
 * stableJsonStringify = JSON.stringify with keys sorted alphabetically,
 *                       no extra whitespace.
 * The fields are listed alphabetically above to show the wire order.
 *
 * The resulting UTF-8 bytes are signed with the device's Ed25519 private key.
 * The 64-byte signature is hex-encoded and submitted as `deviceSignature`.
 */

import { eq, max, inArray } from "drizzle-orm";
import { db, edgeDeviceRegistryTable, ledgerEntriesTable, vesselsTable } from "@workspace/db";
import { computeKeyId } from "./crypto.js";
import { randomUUID } from "crypto";

export type EdgeDeviceStatus = "ACTIVE" | "RETIRED" | "REVOKED";

export interface DeviceRecord {
  deviceId: string;
  vesselId: number;
  vesselName: string | null;
  keyId: string;
  publicKey: string;
  label: string;
  status: EdgeDeviceStatus;
  activatedAt: Date;
  retiredAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
}

// ─── Shared select shape ──────────────────────────────────────────────────────

const DEVICE_SELECT = {
  deviceId: edgeDeviceRegistryTable.deviceId,
  vesselId: edgeDeviceRegistryTable.vesselId,
  vesselName: vesselsTable.name,
  keyId: edgeDeviceRegistryTable.keyId,
  publicKey: edgeDeviceRegistryTable.publicKey,
  label: edgeDeviceRegistryTable.label,
  status: edgeDeviceRegistryTable.status,
  activatedAt: edgeDeviceRegistryTable.activatedAt,
  retiredAt: edgeDeviceRegistryTable.retiredAt,
  revokedAt: edgeDeviceRegistryTable.revokedAt,
  revocationReason: edgeDeviceRegistryTable.revocationReason,
  createdAt: edgeDeviceRegistryTable.createdAt,
} as const;

// ─── Registry operations ──────────────────────────────────────────────────────

/**
 * Register a new edge device.
 *
 * @param publicKey  32-byte Ed25519 public key expressed as 64 lowercase hex chars.
 *                   The private key MUST NOT be provided or transmitted here.
 * @returns  The server-assigned deviceId (UUID).
 */
export async function registerDevice(input: {
  vesselId: number;
  publicKey: string;
  label: string;
}): Promise<string> {
  const deviceId = randomUUID();
  const keyId = computeKeyId(input.publicKey);
  await db.insert(edgeDeviceRegistryTable).values({
    deviceId,
    vesselId: input.vesselId,
    keyId,
    publicKey: input.publicKey,
    label: input.label,
  });
  return deviceId;
}

export async function getDeviceById(deviceId: string): Promise<DeviceRecord | null> {
  const [device] = await db
    .select(DEVICE_SELECT)
    .from(edgeDeviceRegistryTable)
    .leftJoin(vesselsTable, eq(edgeDeviceRegistryTable.vesselId, vesselsTable.id))
    .where(eq(edgeDeviceRegistryTable.deviceId, deviceId));
  return (device as DeviceRecord) ?? null;
}

export async function listDevices(): Promise<DeviceRecord[]> {
  const rows = await db
    .select(DEVICE_SELECT)
    .from(edgeDeviceRegistryTable)
    .leftJoin(vesselsTable, eq(edgeDeviceRegistryTable.vesselId, vesselsTable.id));
  return rows as DeviceRecord[];
}

/**
 * Retrieve multiple devices by ID in one query (for auditor evidence enrichment).
 */
export async function getDevicesByIds(deviceIds: string[]): Promise<Map<string, DeviceRecord>> {
  if (deviceIds.length === 0) return new Map();
  const rows = await db
    .select(DEVICE_SELECT)
    .from(edgeDeviceRegistryTable)
    .leftJoin(vesselsTable, eq(edgeDeviceRegistryTable.vesselId, vesselsTable.id))
    .where(inArray(edgeDeviceRegistryTable.deviceId, deviceIds));
  return new Map((rows as DeviceRecord[]).map((r) => [r.deviceId, r]));
}

/**
 * Retire a device (planned decommission).
 * Retirement preserves historical evidence verifiability.
 * Throws if the device is not ACTIVE or not found.
 */
export async function retireDevice(deviceId: string, _actor: string): Promise<void> {
  const device = await getDeviceById(deviceId);
  if (!device) throw new Error(`Device ${deviceId} not found`);
  if (device.status !== "ACTIVE") {
    throw new Error(`Device ${deviceId} is ${device.status} — only ACTIVE devices can be retired`);
  }
  await db
    .update(edgeDeviceRegistryTable)
    .set({ status: "RETIRED", retiredAt: new Date() })
    .where(eq(edgeDeviceRegistryTable.deviceId, deviceId));
}

/**
 * Revoke a device (security event / compromise).
 * revokedAt is distinct from retiredAt and is used for temporal verification:
 * evidence signed before revokedAt is historically valid; evidence signed after
 * is suspicious and should be flagged.
 * Throws if the device is not found or is already REVOKED.
 */
export async function revokeDevice(
  deviceId: string,
  reason: string,
  _actor: string,
): Promise<void> {
  const device = await getDeviceById(deviceId);
  if (!device) throw new Error(`Device ${deviceId} not found`);
  if (device.status === "REVOKED") {
    throw new Error(`Device ${deviceId} is already REVOKED`);
  }
  const now = new Date();
  await db
    .update(edgeDeviceRegistryTable)
    .set({
      status: "REVOKED",
      retiredAt: device.retiredAt ?? now, // preserve existing retiredAt if already retired
      revokedAt: now,
      revocationReason: reason,
    })
    .where(eq(edgeDeviceRegistryTable.deviceId, deviceId));
}

/**
 * Return the maximum accepted deviceSequenceNumber for a device, or null if
 * no submissions have been accepted yet.  Used for anti-replay validation.
 */
export async function getMaxDeviceSequence(deviceId: string): Promise<number | null> {
  const [result] = await db
    .select({ maxSeq: max(ledgerEntriesTable.deviceSequenceNumber) })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.sourceDeviceId, deviceId));
  return result?.maxSeq ?? null;
}

// ─── Canonical payload ────────────────────────────────────────────────────────

/**
 * Build the canonical evidence payload object that the device Ed25519 key
 * must sign.
 *
 * The server calls verifyPayload(canonicalPayload, deviceSignature, device.publicKey)
 * which internally serializes this object with stableJsonStringify (alphabetically-
 * sorted keys, compact JSON).  A device must use exactly the same serialization
 * when producing the signature.
 *
 * All fields must be present (use explicit null for optional fields that are absent).
 */
export function buildDeviceCanonicalPayload(fields: {
  deviceId: string;
  vesselId: number;
  eventType: string;
  timestampGnss: string;
  timestampDevice: string | null;
  fuelType: string;
  fuelMassKg: number;
  engineLoadPct: number;
  positionLat: number | null;
  positionLon: number | null;
  deviceSequenceNumber: number;
}): Record<string, unknown> {
  return {
    deviceId: fields.deviceId,
    deviceSequenceNumber: fields.deviceSequenceNumber,
    engineLoadPct: fields.engineLoadPct,
    eventType: fields.eventType,
    fuelMassKg: fields.fuelMassKg,
    fuelType: fields.fuelType,
    positionLat: fields.positionLat,
    positionLon: fields.positionLon,
    timestampDevice: fields.timestampDevice,
    timestampGnss: fields.timestampGnss,
    vesselId: fields.vesselId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if err is a Postgres unique-constraint violation (code 23505). */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}
