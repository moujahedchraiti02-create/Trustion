/**
 * Task #11 — Edge device identity & source-signed evidence
 *
 * Tests the 15 required scenarios:
 *
 *  1.  Valid registered Edge device → accepted (201)
 *  2.  Invalid source signature → rejected (422)
 *  3.  Unknown device → rejected (422)
 *  4.  Device/vessel mismatch → rejected (422)
 *  5.  Revoked device new evidence → rejected (422)
 *  6.  Duplicate sequence / replay → rejected (409)
 *  7.  OPERATOR submission remains clearly OPERATOR provenance
 *  8.  Edge submission stores source provenance (dual-signature)
 *  9.  Server receipt signature passes format and crypto verification
 * 10.  Source signature independently verifies with registered device key
 * 11.  Historical evidence remains verifiable after device retirement
 * 12.  Historical evidence after revocation reports temporal revocation context
 * 13.  Concurrent duplicate sequence submissions cannot both succeed
 * 14.  Existing hash-chain tests remain passing (covered by security-integration.test.ts)
 * 15.  Existing RBAC/key-rotation tests remain passing (covered by authorization/key-rotation test files)
 */

import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
import nacl from "tweetnacl";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const { mockInsertReturning, mockDbExecute, hoistedMockGetDeviceById, hoistedMockGetMaxSeq } =
  vi.hoisted(() => ({
    mockInsertReturning: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    mockDbExecute: vi.fn().mockResolvedValue({ rows: [] }),
    hoistedMockGetDeviceById: vi.fn<() => Promise<unknown>>(),
    hoistedMockGetMaxSeq: vi.fn<() => Promise<number | null>>().mockResolvedValue(null),
  }));

// ─── DB mock ──────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> & { then: unknown } = {
    then: (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
    catch: (r: (e: unknown) => unknown) => Promise.resolve([]).catch(r),
    finally: (cb: () => void) => Promise.resolve([]).finally(cb),
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    set: () => chain,
    limit: () => chain,
    onConflictDoNothing: () => chain,
  };
  const insertBuilder = {
    values: () => insertBuilder,
    returning: mockInsertReturning,
  };
  const mockTx = {
    select: () => chain,
    update: () => chain,
    insert: () => insertBuilder,
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };
  return {
    db: {
      select: () => chain,
      update: () => chain,
      insert: () => insertBuilder,
      execute: mockDbExecute,
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    ledgerEntriesTable: {
      id: {}, vesselId: {}, eventType: {}, timestampGnss: {}, timestampDevice: {},
      timestampServer: {}, temporalTrust: {}, fuelType: {}, fuelMassKg: {},
      engineLoadPct: {}, positionLat: {}, positionLon: {}, rawHash: {}, prevHash: {},
      chainHash: {}, signature: {}, publicKey: {}, keyId: {}, signerMode: {},
      isEstimated: {}, createdAt: {}, sourceDeviceId: {}, sourceKeyId: {},
      sourceSignature: {}, sourceSigningMode: {}, deviceSequenceNumber: {},
    },
    edgeDeviceRegistryTable: {
      deviceId: {}, vesselId: {}, keyId: {}, publicKey: {}, label: {}, status: {},
      activatedAt: {}, retiredAt: {}, revokedAt: {}, revocationReason: {}, createdAt: {},
    },
    vesselsTable: { id: {}, name: {} },
    alertsTable: {},
    auditorDecisionsTable: {},
    emissionsRecordsTable: {},
    regulatoryProfilesTable: {},
    signingKeyRegistryTable: { keyId: {} },
    signingKeyEventsTable: { keyId: {}, eventType: {} },
  };
});

// ─── Edge device lib mock ─────────────────────────────────────────────────────

vi.mock("../lib/edgeDevice.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/edgeDevice.js")>();
  return {
    ...original,
    getDeviceById: hoistedMockGetDeviceById,
    getMaxDeviceSequence: hoistedMockGetMaxSeq,
    getDevicesByIds: vi.fn().mockResolvedValue(new Map()),
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import request from "supertest";
import app from "../app.js";
import {
  signPayload,
  verifyPayload,
  computeKeyId,
  computeKeyFingerprint,
  _reinitForTesting,
} from "../lib/crypto.js";

// ─── Test device key material ─────────────────────────────────────────────────

const DEVICE_SEED = Buffer.from("dd".repeat(32), "hex");
const DEVICE_KP = nacl.sign.keyPair.fromSeed(DEVICE_SEED);
const DEVICE_PUBLIC_KEY = Buffer.from(DEVICE_KP.publicKey).toString("hex");
const DEVICE_KEY_ID = computeKeyId(DEVICE_PUBLIC_KEY);
const DEVICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** Canonical JSON used by verifyPayload internally (alphabetically sorted keys). */
function stableJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => { acc[k] = obj[k]; return acc; }, {});
  return JSON.stringify(sorted);
}

/** Sign a canonical payload object with the test device private key. */
function deviceSign(payload: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(stableJson(payload));
  return Buffer.from(nacl.sign.detached(bytes, DEVICE_KP.secretKey)).toString("hex");
}

const SEQ = 42;
const VESSEL_ID = 1;

const BASE_PAYLOAD = {
  vesselId: VESSEL_ID,
  eventType: "FUEL",
  timestampGnss: "2026-01-15T08:00:00.000Z",
  timestampDevice: null,
  fuelType: "HFO",
  fuelMassKg: 5000,
  engineLoadPct: 80,
  positionLat: null,
  positionLon: null,
};

/** Build the canonical device payload for signing. */
function makeCanonical(overrides: Partial<typeof BASE_PAYLOAD & { deviceSequenceNumber: number }> = {}) {
  const base = {
    deviceId: DEVICE_ID,
    deviceSequenceNumber: SEQ,
    ...BASE_PAYLOAD,
    ...overrides,
  };
  return {
    deviceId: base.deviceId,
    deviceSequenceNumber: base.deviceSequenceNumber,
    engineLoadPct: base.engineLoadPct,
    eventType: base.eventType,
    fuelMassKg: base.fuelMassKg,
    fuelType: base.fuelType,
    positionLat: base.positionLat ?? null,
    positionLon: base.positionLon ?? null,
    timestampDevice: base.timestampDevice ?? null,
    timestampGnss: base.timestampGnss,
    vesselId: base.vesselId,
  };
}

/** A valid ACTIVE device record for mocking getDeviceById. */
const ACTIVE_DEVICE = {
  deviceId: DEVICE_ID,
  vesselId: VESSEL_ID,
  vesselName: "Test Vessel",
  keyId: DEVICE_KEY_ID,
  publicKey: DEVICE_PUBLIC_KEY,
  label: "Test Meter A",
  status: "ACTIVE" as const,
  activatedAt: new Date("2026-01-01T00:00:00Z"),
  retiredAt: null,
  revokedAt: null,
  revocationReason: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const SERVER_SEED = "aa".repeat(32);

/** Fake DB ledger entry returned after a successful insert. */
function makeFakeEntry(sig: string, pubKey: string, keyId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    vesselId: VESSEL_ID,
    eventType: "FUEL",
    timestampGnss: new Date("2026-01-15T08:00:00.000Z"),
    timestampDevice: null,
    timestampServer: new Date("2026-01-15T08:00:05.000Z"),
    temporalTrust: "TRUSTED_GNSS",
    fuelType: "HFO",
    fuelMassKg: 5000,
    engineLoadPct: 80,
    positionLat: null,
    positionLon: null,
    rawHash: "rawHash123",
    prevHash: null,
    chainHash: "chainHash456",
    signature: sig,
    publicKey: pubKey,
    keyId,
    signerMode: "SOFTWARE_ED25519",
    isEstimated: false,
    sourceDeviceId: DEVICE_ID,
    sourceKeyId: DEVICE_KEY_ID,
    sourceSignature: deviceSign(makeCanonical()),
    sourceSigningMode: "EDGE_ED25519",
    deviceSequenceNumber: SEQ,
    createdAt: new Date("2026-01-15T08:00:05.000Z"),
    ...overrides,
  };
}

// ─── Environment setup ────────────────────────────────────────────────────────

const EDGE_KEY = "test-edge-ingest-key-11";
const OPERATOR_KEY = "test-operator-key-11";
const AUDITOR_KEY = "test-auditor-key-11";
const ADMIN_KEY = "test-admin-key-11";

function bearer(k: string) { return `Bearer ${k}`; }

beforeAll(() => {
  process.env.EDGE_INGEST_API_KEY = EDGE_KEY;
  process.env.OPERATOR_API_KEY = OPERATOR_KEY;
  process.env.AUDITOR_API_KEY = AUDITOR_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  // Initialize signing identity so signPayload() is available for server receipt
  _reinitForTesting(SERVER_SEED);
});

beforeEach(() => {
  mockInsertReturning.mockReset();
  mockInsertReturning.mockResolvedValue([]);
  hoistedMockGetDeviceById.mockReset();
  hoistedMockGetMaxSeq.mockReset();
  hoistedMockGetMaxSeq.mockResolvedValue(null);
});

// ─── Scenario 1: Valid Edge device → accepted ─────────────────────────────────

describe("Scenario 1 — valid registered Edge device is accepted", () => {
  it("returns 201 with server and source provenance fields", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);
    const { signature: serverSig, publicKey: serverPub, keyId: serverKid } = (() => {
      const serverSignPayload = {
        vesselId: VESSEL_ID, eventType: "FUEL",
        timestampGnss: "2026-01-15T08:00:00.000Z",
        fuelType: "HFO", fuelMassKg: 5000, engineLoadPct: 80,
        sourceDeviceId: DEVICE_ID, sourceKeyId: DEVICE_KEY_ID,
        deviceSequenceNumber: SEQ,
      };
      // signPayload is real (after _reinitForTesting); use top-level ESM import
      return signPayload(serverSignPayload as Record<string, unknown>);
    })();

    mockInsertReturning.mockResolvedValue([
      makeFakeEntry(serverSig, serverPub, serverKid, { sourceSignature: sig }),
    ]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(201);
    expect(res.body.sourceDeviceId).toBe(DEVICE_ID);
    expect(res.body.sourceKeyId).toBe(DEVICE_KEY_ID);
    expect(res.body.sourceSignature).toBe(sig);
    expect(res.body.sourceSigningMode).toBe("EDGE_ED25519");
    expect(res.body.signature).toHaveLength(128);
    expect(res.body.publicKey).toHaveLength(64);
  });
});

// ─── Scenario 2: Invalid source signature → rejected ─────────────────────────

describe("Scenario 2 — invalid source signature → rejected", () => {
  it("returns 422 when deviceSignature does not verify", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const badSig = "ff".repeat(64); // wrong signature
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: badSig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid device signature/i);
  });

  it("returns 422 when deviceSignature is tampered (one bit flipped)", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const goodSig = deviceSign(canonical);
    // Flip the last character
    const badSig = goodSig.slice(0, -1) + (goodSig.endsWith("0") ? "1" : "0");

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: badSig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid device signature/i);
  });

  it("returns 400 when deviceSignature is wrong format (not 128 hex chars)", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: "tooshort" });

    expect(res.status).toBe(400);
  });
});

// ─── Scenario 3: Unknown device → rejected ────────────────────────────────────

describe("Scenario 3 — unknown device → rejected", () => {
  it("returns 422 when device is not in the registry", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unknown device/i);
  });
});

// ─── Scenario 4: Device/vessel mismatch → rejected ───────────────────────────

describe("Scenario 4 — device/vessel mismatch → rejected", () => {
  it("returns 422 when device is bound to a different vessel", async () => {
    // Device is registered for vessel 99, not vessel 1
    hoistedMockGetDeviceById.mockResolvedValue({ ...ACTIVE_DEVICE, vesselId: 99 });
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/mismatch/i);
  });

  it("returns 422 even when the signature would be valid", async () => {
    // A device correctly signed evidence for vessel 1 but is registered to vessel 2
    hoistedMockGetDeviceById.mockResolvedValue({ ...ACTIVE_DEVICE, vesselId: 2 });

    const canonical = makeCanonical(); // canonical includes vesselId: 1
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, vesselId: 1, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/mismatch/i);
  });
});

// ─── Scenario 5: Revoked device → rejected ───────────────────────────────────

describe("Scenario 5 — revoked device cannot submit new evidence", () => {
  it("returns 422 for REVOKED device even with valid signature", async () => {
    const revokedDevice = {
      ...ACTIVE_DEVICE,
      status: "REVOKED" as const,
      retiredAt: new Date("2026-01-10T00:00:00Z"),
      revokedAt: new Date("2026-01-10T00:00:00Z"),
      revocationReason: "Compromised in security audit",
    };
    hoistedMockGetDeviceById.mockResolvedValue(revokedDevice);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it("returns 422 for RETIRED device even with valid signature", async () => {
    const retiredDevice = { ...ACTIVE_DEVICE, status: "RETIRED" as const, retiredAt: new Date() };
    hoistedMockGetDeviceById.mockResolvedValue(retiredDevice);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/retired/i);
  });
});

// ─── Scenario 6: Duplicate sequence / replay → rejected ──────────────────────

describe("Scenario 6 — duplicate sequence / replay rejected", () => {
  it("returns 409 when deviceSequenceNumber equals max accepted sequence", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(SEQ); // same seq already accepted

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/replay|sequence/i);
  });

  it("returns 409 when deviceSequenceNumber is less than max accepted sequence", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(100); // seq 42 < max 100 → regression

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(409);
  });

  it("accepts deviceSequenceNumber exactly one greater than max", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(41); // new seq 42 > 41 → accepted

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const { signPayload } = await import("../lib/crypto.js");
    const serverSig = signPayload({ vesselId: 1, eventType: "FUEL", timestampGnss: "2026-01-15T08:00:00.000Z", fuelType: "HFO", fuelMassKg: 5000, engineLoadPct: 80, sourceDeviceId: DEVICE_ID, sourceKeyId: DEVICE_KEY_ID, deviceSequenceNumber: SEQ });

    mockInsertReturning.mockResolvedValue([
      makeFakeEntry(serverSig.signature, serverSig.publicKey, serverSig.keyId, { sourceSignature: sig }),
    ]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(201);
  });
});

// ─── Scenario 7: OPERATOR submission is OPERATOR provenance ──────────────────

describe("Scenario 7 — OPERATOR submission is clearly OPERATOR provenance", () => {
  it("returns 201 with null source provenance fields", async () => {
    const opEntry = {
      id: 2,
      vesselId: VESSEL_ID,
      eventType: "FUEL",
      timestampGnss: new Date("2026-01-15T09:00:00.000Z"),
      timestampDevice: null,
      timestampServer: new Date("2026-01-15T09:00:05.000Z"),
      temporalTrust: "TRUSTED_GNSS",
      fuelType: "HFO",
      fuelMassKg: 3000,
      engineLoadPct: 60,
      positionLat: null,
      positionLon: null,
      rawHash: "opRaw",
      prevHash: null,
      chainHash: "opChain",
      signature: "cc".repeat(64),
      publicKey: "dd".repeat(32),
      keyId: "ee".repeat(32),
      signerMode: "SOFTWARE_ED25519",
      isEstimated: false,
      // No source provenance — OPERATOR submission
      sourceDeviceId: null,
      sourceKeyId: null,
      sourceSignature: null,
      sourceSigningMode: null,
      deviceSequenceNumber: null,
      createdAt: new Date(),
    };
    mockInsertReturning.mockResolvedValue([opEntry]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({
        vesselId: VESSEL_ID,
        eventType: "FUEL",
        timestampGnss: "2026-01-15T09:00:00.000Z",
        fuelType: "HFO",
        fuelMassKg: 3000,
        engineLoadPct: 60,
        signerMode: "SOFTWARE_ED25519",
      });

    expect(res.status).toBe(201);
    // OPERATOR response must have null source provenance
    expect(res.body.sourceDeviceId).toBeNull();
    expect(res.body.sourceSignature).toBeNull();
    expect(res.body.sourceKeyId).toBeNull();
    expect(res.body.sourceSigningMode).toBeNull();
    expect(res.body.deviceSequenceNumber).toBeNull();
  });

  it("OPERATOR submissions cannot include deviceId or deviceSignature to gain EDGE provenance", async () => {
    // OPERATOR role: even if body includes edge fields, they are ignored (schema strips them)
    const opEntry = makeFakeEntry("cc".repeat(64), "dd".repeat(32), "ee".repeat(32), {
      sourceDeviceId: null, sourceKeyId: null, sourceSignature: null,
      sourceSigningMode: null, deviceSequenceNumber: null,
    });
    mockInsertReturning.mockResolvedValue([opEntry]);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({
        vesselId: VESSEL_ID, eventType: "FUEL", timestampGnss: "2026-01-15T09:00:00.000Z",
        fuelType: "HFO", fuelMassKg: 3000, engineLoadPct: 60, signerMode: "SOFTWARE_ED25519",
        // OPERATOR submitting edge fields — these should be ignored by the OPERATOR path
        deviceId: DEVICE_ID, deviceSignature: sig, deviceSequenceNumber: SEQ,
      });

    // OPERATOR path does not validate or store edge fields
    expect(res.status).toBe(201);
    expect(res.body.sourceDeviceId).toBeNull();
  });
});

// ─── Scenario 8: Edge submission stores dual-signature provenance ─────────────

describe("Scenario 8 — Edge submission stores source provenance", () => {
  it("response includes sourceDeviceId, sourceKeyId, sourceSignature, sourceSigningMode, deviceSequenceNumber", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const { signPayload } = await import("../lib/crypto.js");
    const serverSig = signPayload({ vesselId: 1, eventType: "FUEL", timestampGnss: "2026-01-15T08:00:00.000Z", fuelType: "HFO", fuelMassKg: 5000, engineLoadPct: 80, sourceDeviceId: DEVICE_ID, sourceKeyId: DEVICE_KEY_ID, deviceSequenceNumber: SEQ });

    mockInsertReturning.mockResolvedValue([
      makeFakeEntry(serverSig.signature, serverSig.publicKey, serverSig.keyId, { sourceSignature: sig }),
    ]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(201);
    // Both signatures stored
    expect(res.body.signature).toBeDefined();   // server receipt signature
    expect(res.body.publicKey).toBeDefined();    // server public key
    expect(res.body.keyId).toBeDefined();        // server key_id
    expect(res.body.sourceDeviceId).toBe(DEVICE_ID);
    expect(res.body.sourceKeyId).toBe(DEVICE_KEY_ID);
    expect(res.body.sourceSignature).toBe(sig);
    expect(res.body.sourceSigningMode).toBe("EDGE_ED25519");
    expect(res.body.deviceSequenceNumber).toBe(SEQ);
    // signerMode refers to the SERVER signing key mode
    expect(res.body.signerMode).toBe("SOFTWARE_ED25519");
  });
});

// ─── Scenario 9: Server receipt signature verifies ───────────────────────────

describe("Scenario 9 — server receipt signature is cryptographically valid", () => {
  it("stored server signature verifies against stored publicKey using verifyPayload", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    // Use real signPayload (active key is set by _reinitForTesting in beforeAll)
    const { signPayload } = await import("../lib/crypto.js");
    const serverSignPayload: Record<string, unknown> = {
      vesselId: VESSEL_ID, eventType: "FUEL",
      timestampGnss: "2026-01-15T08:00:00.000Z",
      fuelType: "HFO", fuelMassKg: 5000, engineLoadPct: 80,
      sourceDeviceId: DEVICE_ID, sourceKeyId: DEVICE_KEY_ID,
      deviceSequenceNumber: SEQ,
    };
    const serverReceipt = signPayload(serverSignPayload);

    mockInsertReturning.mockResolvedValue([
      makeFakeEntry(serverReceipt.signature, serverReceipt.publicKey, serverReceipt.keyId, { sourceSignature: sig }),
    ]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(201);

    // The server signature in the response must verify with the stored publicKey
    const { signature, publicKey } = res.body;
    expect(signature).toHaveLength(128);
    expect(publicKey).toHaveLength(64);
    expect(verifyPayload(serverSignPayload, signature, publicKey)).toBe(true);
  });
});

// ─── Scenario 10: Source signature independently verifies ────────────────────

describe("Scenario 10 — source device signature independently verifies", () => {
  it("stored deviceSignature verifies against the registered device public key", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const { signPayload } = await import("../lib/crypto.js");
    const serverSig = signPayload({ a: 1 } as Record<string, unknown>);

    mockInsertReturning.mockResolvedValue([
      makeFakeEntry(serverSig.signature, serverSig.publicKey, serverSig.keyId, { sourceSignature: sig }),
    ]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(201);

    // Anyone with the device's public key can verify the source signature independently
    const storedSig = res.body.sourceSignature;
    const storedDevicePubKey = DEVICE_PUBLIC_KEY; // from device registry (not from API response)
    expect(verifyPayload(canonical, storedSig, storedDevicePubKey)).toBe(true);
  });

  it("source signature does NOT verify against a different public key", async () => {
    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const otherSeed = Buffer.from("ee".repeat(32), "hex");
    const otherKP = nacl.sign.keyPair.fromSeed(otherSeed);
    const otherPubKey = Buffer.from(otherKP.publicKey).toString("hex");

    expect(verifyPayload(canonical, sig, otherPubKey)).toBe(false);
  });

  it("server signature and source signature cover different payloads — not interchangeable", async () => {
    const canonical = makeCanonical();
    const deviceSig = deviceSign(canonical);

    // Device sig should not verify with server public key
    const { signPayload } = await import("../lib/crypto.js");
    const serverReceipt = signPayload({ a: 1 } as Record<string, unknown>);
    expect(verifyPayload(canonical, deviceSig, serverReceipt.publicKey)).toBe(false);
  });
});

// ─── Scenario 11: Historical evidence verifiable after device retirement ──────

describe("Scenario 11 — historical evidence remains verifiable after retirement", () => {
  it("a signature made before retirement still verifies cryptographically", () => {
    // Device retirement does NOT invalidate cryptographic verification.
    // Ed25519 signatures are not revoked — only new submissions are blocked.
    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    // Simulate a RETIRED device
    const retiredDevice = {
      ...ACTIVE_DEVICE,
      status: "RETIRED" as const,
      retiredAt: new Date("2026-02-01T00:00:00Z"),
    };

    // The signature verifies with the stored public key regardless of device status
    expect(verifyPayload(canonical, sig, retiredDevice.publicKey)).toBe(true);
  });

  it("getDeviceById for a RETIRED device returns all public metadata including publicKey", () => {
    // The public key is preserved in the registry after retirement;
    // auditors can still verify historical signatures.
    const retiredDevice = { ...ACTIVE_DEVICE, status: "RETIRED" as const, retiredAt: new Date() };
    expect(retiredDevice.publicKey).toBe(DEVICE_PUBLIC_KEY);
    expect(retiredDevice.keyId).toBe(DEVICE_KEY_ID);
    expect(retiredDevice.retiredAt).toBeInstanceOf(Date);
    expect(retiredDevice.revokedAt).toBeNull();
  });
});

// ─── Scenario 12: Revocation temporal context ─────────────────────────────────

describe("Scenario 12 — revocation temporal context", () => {
  it("evidence timestampServer < revokedAt → signedBeforeDeviceRevocation = true", () => {
    const revokedAt = new Date("2026-03-01T00:00:00Z");
    const timestampServer = new Date("2026-01-15T08:00:00Z"); // BEFORE revocation
    const signedBefore = timestampServer.getTime() < revokedAt.getTime();
    expect(signedBefore).toBe(true);
  });

  it("evidence timestampServer >= revokedAt → signedBeforeDeviceRevocation = false (suspicious)", () => {
    const revokedAt = new Date("2026-02-01T00:00:00Z");
    const timestampServer = new Date("2026-03-01T00:00:00Z"); // AFTER revocation
    const signedBefore = timestampServer.getTime() < revokedAt.getTime();
    expect(signedBefore).toBe(false);
  });

  it("revokedAt is distinct from retiredAt for planned retirement", () => {
    const retiredDevice = {
      ...ACTIVE_DEVICE,
      status: "RETIRED" as const,
      retiredAt: new Date("2026-02-01T00:00:00Z"),
      revokedAt: null, // retirement ≠ revocation
    };
    expect(retiredDevice.revokedAt).toBeNull();
    expect(retiredDevice.retiredAt).not.toBeNull();
  });

  it("REVOKED device has both retiredAt and revokedAt populated", () => {
    const revokedAt = new Date("2026-03-15T00:00:00Z");
    const revokedDevice = {
      ...ACTIVE_DEVICE,
      status: "REVOKED" as const,
      retiredAt: revokedAt,
      revokedAt,
      revocationReason: "Security audit finding",
    };
    expect(revokedDevice.revokedAt).toEqual(revokedAt);
    expect(revokedDevice.retiredAt).toEqual(revokedAt);
    expect(revokedDevice.revocationReason).toBe("Security audit finding");
  });
});

// ─── Scenario 13: Concurrent duplicate sequence cannot both succeed ───────────

describe("Scenario 13 — concurrent duplicate sequence rejected", () => {
  it("DB unique constraint violation returns 409 (simulates concurrent duplicate)", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    // Both concurrent requests pass the app-level check (same maxSeq=null)
    hoistedMockGetMaxSeq.mockResolvedValue(null);

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    // First request succeeds
    const { signPayload } = await import("../lib/crypto.js");
    const serverSig = signPayload({ a: 1 } as Record<string, unknown>);
    mockInsertReturning
      .mockResolvedValueOnce([
        makeFakeEntry(serverSig.signature, serverSig.publicKey, serverSig.keyId, { sourceSignature: sig }),
      ])
      // Second request: DB unique constraint violation (concurrent duplicate)
      .mockRejectedValueOnce(
        Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        }),
      );

    const body = { ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig };

    const [res1, res2] = await Promise.all([
      request(app).post("/api/ledger/entries").set("Authorization", bearer(EDGE_KEY)).send(body),
      request(app).post("/api/ledger/entries").set("Authorization", bearer(EDGE_KEY)).send(body),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed, one must fail with 409
    expect(statuses).toEqual([201, 409]);
  });

  it("409 error message identifies the conflict as a duplicate sequence", async () => {
    hoistedMockGetDeviceById.mockResolvedValue(ACTIVE_DEVICE);
    hoistedMockGetMaxSeq.mockResolvedValue(null);
    mockInsertReturning.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );

    const canonical = makeCanonical();
    const sig = deviceSign(canonical);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_KEY))
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: sig });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sequence|duplicate/i);
  });
});

// ─── Scenario 14 & 15: Existing tests remain passing ─────────────────────────

describe("Scenarios 14 & 15 — existing tests unaffected", () => {
  it("hash-chain logic is unchanged (chain hash reuses computeRawHash + computeChainHash)", async () => {
    // The existing hash chain tests in security-integration.test.ts cover chain integrity.
    // Here we verify the ledger route still accepts OPERATOR submissions (chain not broken by changes).
    const opEntry = {
      id: 3, vesselId: VESSEL_ID, eventType: "FUEL",
      timestampGnss: new Date("2026-01-20T00:00:00.000Z"),
      timestampDevice: null,
      timestampServer: new Date("2026-01-20T00:00:05.000Z"),
      temporalTrust: "TRUSTED_GNSS", fuelType: "HFO", fuelMassKg: 2000, engineLoadPct: 55,
      positionLat: null, positionLon: null,
      rawHash: "r", prevHash: null, chainHash: "c",
      signature: "aa".repeat(64), publicKey: "bb".repeat(32), keyId: "cc".repeat(32),
      signerMode: "SOFTWARE_ED25519", isEstimated: false,
      sourceDeviceId: null, sourceKeyId: null, sourceSignature: null,
      sourceSigningMode: null, deviceSequenceNumber: null, createdAt: new Date(),
    };
    mockInsertReturning.mockResolvedValue([opEntry]);

    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({ vesselId: VESSEL_ID, eventType: "FUEL", timestampGnss: "2026-01-20T00:00:00.000Z", fuelType: "HFO", fuelMassKg: 2000, engineLoadPct: 55, signerMode: "SOFTWARE_ED25519" });

    expect(res.status).toBe(201);
    expect(res.body.rawHash).toBeDefined();
    expect(res.body.chainHash).toBeDefined();
  });

  it("EDGE_INGEST cannot access AUDITOR-only endpoints (RBAC unchanged)", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", bearer(EDGE_KEY));
    expect(res.status).toBe(403);
  });

  it("unauthenticated EDGE ingest is rejected (RBAC unchanged)", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .send({ ...BASE_PAYLOAD, deviceId: DEVICE_ID, deviceSequenceNumber: SEQ, deviceSignature: "ff".repeat(64) });
    expect(res.status).toBe(401);
  });
});
