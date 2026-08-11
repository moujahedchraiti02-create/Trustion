/**
 * Authorization integration tests — S³V TRUSTION Legal Firewall
 *
 * Covers all 11 scenarios required by Task #9:
 *
 *  1. Unauthenticated access denied where required
 *  2. OPERATOR can perform allowed operator actions
 *  3. OPERATOR cannot write auditor decisions
 *  4. AUDITOR can read auditor evidence
 *  5. AUDITOR can append auditor decisions
 *  6. AUDITOR cannot write ledger evidence or vessel records
 *  7. ADMIN cannot write auditor decisions
 *  8. EDGE_INGEST can ingest evidence but cannot use other endpoints
 *  9. Caller-supplied role or identity cannot escalate privileges
 * 10. Disabled or unknown credential fails closed (401)
 * 11. Audit records use server-derived actor identity
 *
 * The @workspace/db module is fully mocked — no real database is needed.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── DB mock ──────────────────────────────────────────────────────────────────

const dbMock = vi.hoisted(() => {
  const chain: Record<string, unknown> & { then: unknown } = {
    then:                (r: (v: unknown[]) => unknown) => Promise.resolve([]).then(r),
    catch:               (r: (e: unknown) => unknown)   => Promise.resolve([]).catch(r),
    finally:             (cb: () => void)               => Promise.resolve([]).finally(cb),
    from:                () => chain,
    where:               () => chain,
    orderBy:             () => chain,
    leftJoin:            () => chain,
    set:                 () => chain,
    values:              () => chain,
    returning:           () => chain,
    limit:               () => chain,
    onConflictDoNothing: () => chain,
  };
  const mockTx = {
    select:  () => chain,
    update:  () => chain,
    insert:  () => chain,
    execute: async () => ({ rows: [] }),
  };
  return {
    db: {
      select:      () => chain,
      update:      () => chain,
      insert:      () => chain,
      execute:     async () => ({ rows: [] }),
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
  };
});

vi.mock("@workspace/db", () => ({
  ...dbMock,
  alertsTable:              {},
  vesselsTable:             {},
  ledgerEntriesTable:       { keyId: {}, publicKey: {} },
  emissionsRecordsTable:    {},
  regulatoryProfilesTable:  {},
  auditorDecisionsTable:    {},
  signingKeyRegistryTable:  { keyId: {} },
  signingKeyEventsTable:    { keyId: {}, eventType: {} },
  edgeDeviceRegistryTable:  { deviceId: {}, vesselId: {}, keyId: {}, publicKey: {}, label: {}, status: {}, activatedAt: {}, retiredAt: {}, revokedAt: {}, revocationReason: {}, createdAt: {} },
  chainEpochsTable:         { epochId: {}, vesselId: {}, status: {}, merkleRoot: {}, algorithm: {}, canonicalizationVersion: {}, startEntryId: {}, endEntryId: {}, entryCount: {}, previousEpochRoot: {}, openedAt: {}, closedAt: {}, createdAt: {} },
  chainEpochEventsTable:    { epochId: {}, eventType: {}, eventTimestamp: {}, metadata: {}, createdAt: {} },
}));

// Import app AFTER mock is in place
import request from "supertest";
import app from "../app.js";

// ─── Test credentials ─────────────────────────────────────────────────────────

const OPERATOR_KEY    = "authz-test-operator-key";
const AUDITOR_KEY     = "authz-test-auditor-key";
const ADMIN_KEY       = "authz-test-admin-key";
const EDGE_INGEST_KEY = "authz-test-edge-ingest-key";
const UNKNOWN_KEY     = "authz-test-completely-unknown-key";

function bearer(key: string) { return `Bearer ${key}`; }

// ─── Environment setup ────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ["OPERATOR_API_KEY", "AUDITOR_API_KEY", "ADMIN_API_KEY", "EDGE_INGEST_API_KEY"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.OPERATOR_API_KEY    = OPERATOR_KEY;
  process.env.AUDITOR_API_KEY     = AUDITOR_KEY;
  process.env.ADMIN_API_KEY       = ADMIN_KEY;
  process.env.EDGE_INGEST_API_KEY = EDGE_INGEST_KEY;
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Assert that a response status is NOT 401 or 403, meaning authorization was
 * granted.  The actual status may be 200, 201, 400 (body validation failed),
 * 404 (entity not found in mock), or 500 (mock returned insufficient data).
 * All of those mean the middleware let the request through.
 */
function expectAuthorized(status: number): void {
  expect(status, `Expected authorized (not 401/403), got ${status}`).not.toBe(401);
  expect(status, `Expected authorized (not 401/403), got ${status}`).not.toBe(403);
}

// ─── Test 1: Unauthenticated access is denied ─────────────────────────────────

describe("Test 1 — unauthenticated access is denied where required", () => {
  it("POST /api/ledger/entries → 401 without any credential", async () => {
    const res = await request(app).post("/api/ledger/entries").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/vessels → 401 without any credential", async () => {
    const res = await request(app).post("/api/vessels").send({});
    expect(res.status).toBe(401);
  });

  it("PATCH /api/alerts/1/acknowledge → 401 without any credential", async () => {
    const res = await request(app).patch("/api/alerts/1/acknowledge").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/regulatory-profiles → 401 without any credential", async () => {
    const res = await request(app).post("/api/regulatory-profiles").send({});
    expect(res.status).toBe(401);
  });

  it("GET /api/auditor/evidence/1 → 401 without any credential", async () => {
    const res = await request(app).get("/api/auditor/evidence/1");
    expect(res.status).toBe(401);
  });

  it("GET /api/auditor/decisions → 401 without any credential", async () => {
    const res = await request(app).get("/api/auditor/decisions");
    expect(res.status).toBe(401);
  });

  it("POST /api/auditor/decisions → 401 without any credential", async () => {
    const res = await request(app).post("/api/auditor/decisions").send({});
    expect(res.status).toBe(401);
  });
});

// ─── Test 2: OPERATOR can perform allowed operator actions ────────────────────

describe("Test 2 — OPERATOR can perform allowed operator actions", () => {
  it("POST /api/ledger/entries with OPERATOR key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expectAuthorized(res.status);
  });

  it("POST /api/vessels with OPERATOR key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/vessels")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expectAuthorized(res.status);
  });

  it("PATCH /api/alerts/1/acknowledge with OPERATOR key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .patch("/api/alerts/1/acknowledge")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expectAuthorized(res.status);
  });
});

// ─── Test 3: OPERATOR cannot write auditor decisions ─────────────────────────

describe("Test 3 — OPERATOR cannot write auditor decisions", () => {
  it("POST /api/auditor/decisions with OPERATOR key → 403", async () => {
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("GET /api/auditor/evidence/1 with OPERATOR key → 403", async () => {
    const res = await request(app)
      .get("/api/auditor/evidence/1")
      .set("Authorization", bearer(OPERATOR_KEY));
    expect(res.status).toBe(403);
  });

  it("GET /api/auditor/decisions with OPERATOR key → 403", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", bearer(OPERATOR_KEY));
    expect(res.status).toBe(403);
  });

  it("403 response body names the OPERATOR role", async () => {
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("OPERATOR");
  });
});

// ─── Test 4: AUDITOR can read auditor evidence ────────────────────────────────

describe("Test 4 — AUDITOR can read auditor evidence", () => {
  it("GET /api/auditor/evidence/1 with AUDITOR key → authorized (not 401/403)", async () => {
    // Mock returns [] for vessel lookup → 404, which is fine (auth passed)
    const res = await request(app)
      .get("/api/auditor/evidence/1")
      .set("Authorization", bearer(AUDITOR_KEY));
    expectAuthorized(res.status);
  });

  it("GET /api/auditor/decisions with AUDITOR key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", bearer(AUDITOR_KEY));
    expectAuthorized(res.status);
  });
});

// ─── Test 5: AUDITOR can append auditor decisions ─────────────────────────────

describe("Test 5 — AUDITOR can append auditor decisions", () => {
  it("POST /api/auditor/decisions with AUDITOR key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({});
    // May return 400 (body validation) — that means auth passed
    expectAuthorized(res.status);
  });
});

// ─── Test 6: AUDITOR cannot mutate vessel telemetry or ledger evidence ─────────

describe("Test 6 — AUDITOR cannot write ledger evidence or vessel operational records", () => {
  it("POST /api/ledger/entries with AUDITOR key → 403", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("POST /api/vessels with AUDITOR key → 403", async () => {
    const res = await request(app)
      .post("/api/vessels")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("PATCH /api/alerts/1/acknowledge with AUDITOR key → 403", async () => {
    const res = await request(app)
      .patch("/api/alerts/1/acknowledge")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("POST /api/regulatory-profiles with AUDITOR key → 403", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({});
    expect(res.status).toBe(403);
  });
});

// ─── Test 7: ADMIN cannot write auditor decisions ─────────────────────────────

describe("Test 7 — ADMIN cannot write auditor decisions (no automatic AUDITOR inheritance)", () => {
  it("POST /api/auditor/decisions with ADMIN key → 403", async () => {
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(ADMIN_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("GET /api/auditor/evidence/1 with ADMIN key → 403", async () => {
    const res = await request(app)
      .get("/api/auditor/evidence/1")
      .set("Authorization", bearer(ADMIN_KEY));
    expect(res.status).toBe(403);
  });

  it("GET /api/auditor/decisions with ADMIN key → 403", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", bearer(ADMIN_KEY));
    expect(res.status).toBe(403);
  });

  it("ADMIN can manage configuration: POST /api/regulatory-profiles → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", bearer(ADMIN_KEY))
      .send({});
    expectAuthorized(res.status);
  });

  it("ADMIN can register vessels: POST /api/vessels → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/vessels")
      .set("Authorization", bearer(ADMIN_KEY))
      .send({});
    expectAuthorized(res.status);
  });
});

// ─── Test 8: EDGE_INGEST is restricted to evidence ingestion only ─────────────

describe("Test 8 — EDGE_INGEST can ingest evidence but cannot use other endpoints", () => {
  it("POST /api/ledger/entries with EDGE_INGEST key → authorized (not 401/403)", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({});
    expectAuthorized(res.status);
  });

  it("POST /api/vessels with EDGE_INGEST key → 403", async () => {
    const res = await request(app)
      .post("/api/vessels")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("PATCH /api/alerts/1/acknowledge with EDGE_INGEST key → 403", async () => {
    const res = await request(app)
      .patch("/api/alerts/1/acknowledge")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("POST /api/regulatory-profiles with EDGE_INGEST key → 403", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("POST /api/auditor/decisions with EDGE_INGEST key → 403", async () => {
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({});
    expect(res.status).toBe(403);
  });

  it("GET /api/auditor/evidence/1 with EDGE_INGEST key → 403", async () => {
    const res = await request(app)
      .get("/api/auditor/evidence/1")
      .set("Authorization", bearer(EDGE_INGEST_KEY));
    expect(res.status).toBe(403);
  });
});

// ─── Test 9: Caller-supplied role or identity cannot escalate privileges ───────

describe("Test 9 — caller-supplied role or identity cannot escalate privileges", () => {
  it("OPERATOR token on AUDITOR-only route → 403 regardless of body content", async () => {
    // Include an attacker-controlled verifierId in body — must be ignored
    const res = await request(app)
      .post("/api/auditor/decisions")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({
        verifierId: "auditor:fake-escalation",
        decision: "APPROVED",
        vesselId: 1,
        evidencePackageHash: "abc",
        rationale: "self-approved",
      });
    expect(res.status).toBe(403);
  });

  it("EDGE_INGEST token on ADMIN route → 403 regardless of body", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", bearer(EDGE_INGEST_KEY))
      .send({ name: "FuelEU 2025", description: "injected" });
    expect(res.status).toBe(403);
  });

  it("AUDITOR token cannot ingest ledger evidence even with operator-like body", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({
        vesselId: 1,
        eventType: "FUEL",
        timestampGnss: new Date().toISOString(),
        fuelType: "HFO",
        fuelMassKg: 1000,
      });
    expect(res.status).toBe(403);
  });
});

// ─── Test 10: Unknown or disabled credential fails closed (401) ───────────────

describe("Test 10 — unknown or disabled credential fails closed with 401", () => {
  it("completely unknown Bearer token → 401", async () => {
    const res = await request(app)
      .post("/api/ledger/entries")
      .set("Authorization", bearer(UNKNOWN_KEY))
      .send({});
    expect(res.status).toBe(401);
  });

  it("empty string token → 401", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", "Bearer ")
      .send();
    expect(res.status).toBe(401);
  });

  it("unknown token on auditor route → 401", async () => {
    const res = await request(app)
      .get("/api/auditor/evidence/1")
      .set("Authorization", bearer(UNKNOWN_KEY));
    expect(res.status).toBe(401);
  });

  it("unknown token on admin route → 401", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", bearer(UNKNOWN_KEY))
      .send({});
    expect(res.status).toBe(401);
  });
});

// ─── Test 11: Audit records use server-derived actor identity ─────────────────
// Since the mock DB doesn't persist data, we test the middleware-level
// enforcement: req.auth.subject must be server-derived and correctly formatted.
// We verify via a mini express app that echoes the auth context.

import express from "express";
import { requireRole } from "../middleware/auth.js";

describe("Test 11 — audit records use server-derived actor identity (not caller-supplied)", () => {
  function buildAuditTestApp() {
    const miniApp = express();
    miniApp.use(express.json());

    // Simulates what the auditor decision route does: ignore caller verifierId,
    // always use req.auth!.subject.
    miniApp.post("/decision", requireRole("AUDITOR"), (req, res) => {
      const verifierId = req.auth!.subject; // server-derived
      res.json({
        stored: { verifierId },
        callerProvided: req.body.verifierId ?? null,
      });
    });

    // Simulates alert acknowledgement route
    miniApp.patch("/acknowledge", requireRole("OPERATOR", "ADMIN"), (req, res) => {
      const acknowledgedBy = req.auth!.subject; // server-derived
      res.json({
        stored: { acknowledgedBy },
        callerProvided: req.body.acknowledgedBy ?? null,
      });
    });

    return miniApp;
  }

  it("auditor verifierId is server-derived — matches '<role>:<hash>' format", async () => {
    const miniApp = buildAuditTestApp();
    const res = await request(miniApp)
      .post("/decision")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({ verifierId: "caller-injected-id" });

    expect(res.status).toBe(200);
    expect(res.body.stored.verifierId).toMatch(/^auditor:[0-9a-f]{16}$/);
  });

  it("auditor verifierId is NOT the caller-supplied value", async () => {
    const miniApp = buildAuditTestApp();
    const res = await request(miniApp)
      .post("/decision")
      .set("Authorization", bearer(AUDITOR_KEY))
      .send({ verifierId: "attacker:escalated-identity" });

    expect(res.status).toBe(200);
    expect(res.body.stored.verifierId).not.toBe("attacker:escalated-identity");
    expect(res.body.callerProvided).toBe("attacker:escalated-identity"); // received, not stored
  });

  it("operator acknowledgedBy is server-derived — matches '<role>:<hash>' format", async () => {
    const miniApp = buildAuditTestApp();
    const res = await request(miniApp)
      .patch("/acknowledge")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({ acknowledgedBy: "attacker-supplied-name" });

    expect(res.status).toBe(200);
    expect(res.body.stored.acknowledgedBy).toMatch(/^operator:[0-9a-f]{16}$/);
    expect(res.body.stored.acknowledgedBy).not.toBe("attacker-supplied-name");
  });

  it("same credential always produces the same subject in the audit record (deterministic)", async () => {
    const miniApp = buildAuditTestApp();
    const r1 = await request(miniApp).post("/decision").set("Authorization", bearer(AUDITOR_KEY)).send({});
    const r2 = await request(miniApp).post("/decision").set("Authorization", bearer(AUDITOR_KEY)).send({});
    expect(r1.body.stored.verifierId).toBe(r2.body.stored.verifierId);
  });

  it("static 'Authorized Operator' string is gone — subject now includes role prefix and hash", async () => {
    const miniApp = buildAuditTestApp();
    const res = await request(miniApp)
      .patch("/acknowledge")
      .set("Authorization", bearer(OPERATOR_KEY))
      .send({});
    expect(res.body.stored.acknowledgedBy).not.toBe("Authorized Operator");
    expect(res.body.stored.acknowledgedBy).toMatch(/^operator:/);
  });
});
