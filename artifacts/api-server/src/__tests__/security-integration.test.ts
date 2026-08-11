/**
 * Security integration tests
 *
 * Tests 6-8 from the Task-7 requirements:
 *   6. Public endpoints remain public only where explicitly intended;
 *      protected endpoints require a valid credential for the correct role.
 *   7. Pagination limits cannot exceed the server-side maximum.
 *   8. Rate limiting actually rejects excessive requests.
 *
 * The @workspace/db module is fully mocked so no real database is required.
 */
import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

// ─── DB mock (hoisted so vi.mock factory can reference it) ──────────────────
const { mockDb, resetLimitCapture, getCapturedLimit } = vi.hoisted(() => {
  let capturedLimit: number | undefined;

  // A thenable chain: every method returns itself so any sequence of Drizzle
  // calls can be awaited and resolves to `[]` by default.
  const chain: Record<string, unknown> & { then: unknown } = {
    then: (resolve: (v: unknown[]) => unknown) =>
      Promise.resolve([]).then(resolve),
    catch: (reject: (e: unknown) => unknown) =>
      Promise.resolve([]).catch(reject),
    finally: (cb: () => void) => Promise.resolve([]).finally(cb),
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    set: () => chain,
    values: () => chain,
    returning: () => chain,
    limit: (n: number) => {
      capturedLimit = n;
      return chain;
    },
  };

  const mockDb = {
    select: () => chain,
    update: () => chain,
    insert: () => chain,
    execute: async () => ({ rows: [] }),
  };

  return {
    mockDb,
    resetLimitCapture: () => { capturedLimit = undefined; },
    getCapturedLimit: () => capturedLimit,
  };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  alertsTable: {},
  vesselsTable: {},
  ledgerEntriesTable: {},
  emissionsRecordsTable: {},
  regulatoryProfilesTable: {},
  auditorDecisionsTable: {},
}));

// Import app AFTER vi.mock so the mock is in place
import request from "supertest";
import app from "../app.js";
import { LEDGER_QUERY_MAX_LIMIT } from "../routes/ledger.js";

// ─── Environment helpers ─────────────────────────────────────────────────────

const OPERATOR_KEY    = "integration-test-operator";
const AUDITOR_KEY     = "integration-test-auditor";
const ADMIN_KEY       = "integration-test-admin";
const EDGE_INGEST_KEY = "integration-test-edge";

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

// ─── Test 6: Public vs protected endpoint access ─────────────────────────────
describe("Public vs protected route access (test 6)", () => {
  afterEach(() => resetLimitCapture());

  // --- Explicitly public routes (no auth required) ---
  it("GET /api/vessels is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/vessels");
    expect(res.status).toBe(200);
  });

  it("GET /api/ledger/entries is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/ledger/entries");
    expect(res.status).toBe(200);
  });

  it("GET /api/ledger/chain-status is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/ledger/chain-status");
    expect(res.status).toBe(200);
  });

  it("GET /api/alerts is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/alerts");
    expect(res.status).toBe(200);
  });

  it("GET /api/regulatory-profiles is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/regulatory-profiles");
    expect(res.status).toBe(200);
  });

  it("GET /api/healthz is public — responds 200 without credentials", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });

  // --- Protected auditor reads require AUDITOR role ---
  it("GET /api/auditor/evidence/:id requires AUDITOR authentication — 401 without key", async () => {
    const res = await request(app).get("/api/auditor/evidence/1");
    expect(res.status).toBe(401);
  });

  it("GET /api/auditor/decisions requires AUDITOR authentication — 401 without key", async () => {
    const res = await request(app).get("/api/auditor/decisions");
    expect(res.status).toBe(401);
  });

  // --- Protected write operations require appropriate role ---
  it("POST /api/ledger/entries requires OPERATOR/EDGE_INGEST — 401 without key", async () => {
    const res = await request(app).post("/api/ledger/entries").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/vessels requires OPERATOR/ADMIN — 401 without key", async () => {
    const res = await request(app).post("/api/vessels").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/regulatory-profiles requires ADMIN — 401 without key", async () => {
    const res = await request(app).post("/api/regulatory-profiles").send({});
    expect(res.status).toBe(401);
  });

  it("PATCH /api/alerts/:id/acknowledge requires OPERATOR/ADMIN — 401 without key", async () => {
    const res = await request(app).patch("/api/alerts/1/acknowledge").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/auditor/decisions requires AUDITOR — 401 without key", async () => {
    const res = await request(app).post("/api/auditor/decisions").send({});
    expect(res.status).toBe(401);
  });

  // --- With correct credentials, protected routes are accessible ---
  it("GET /api/auditor/decisions with AUDITOR key → not 401/403", async () => {
    const res = await request(app)
      .get("/api/auditor/decisions")
      .set("Authorization", `Bearer ${AUDITOR_KEY}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("POST /api/vessels with OPERATOR key → not 401/403", async () => {
    const res = await request(app)
      .post("/api/vessels")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`)
      .send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("POST /api/regulatory-profiles with ADMIN key → not 401/403", async () => {
    const res = await request(app)
      .post("/api/regulatory-profiles")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({});
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─── Test 7: Pagination limit cap ────────────────────────────────────────────
describe("Pagination limit cap (test 7)", () => {
  afterEach(() => resetLimitCapture());

  it("LEDGER_QUERY_MAX_LIMIT constant is defined and positive", () => {
    expect(typeof LEDGER_QUERY_MAX_LIMIT).toBe("number");
    expect(LEDGER_QUERY_MAX_LIMIT).toBeGreaterThan(0);
  });

  it("GET /api/ledger/entries?limit=999999 responds 200 (server handles gracefully)", async () => {
    const res = await request(app).get("/api/ledger/entries?limit=999999");
    expect(res.status).toBe(200);
  });

  it("the DB query is called with at most LEDGER_QUERY_MAX_LIMIT rows", async () => {
    resetLimitCapture();
    await request(app).get(`/api/ledger/entries?limit=999999`);
    const used = getCapturedLimit();
    expect(used).toBeDefined();
    expect(used!).toBeLessThanOrEqual(LEDGER_QUERY_MAX_LIMIT);
    expect(used!).toBe(LEDGER_QUERY_MAX_LIMIT);
  });

  it("a request within the cap passes through unchanged", async () => {
    resetLimitCapture();
    await request(app).get(`/api/ledger/entries?limit=10`);
    expect(getCapturedLimit()).toBe(10);
  });
});

// ─── Test 8: Rate limiting ────────────────────────────────────────────────────
describe("Rate limiting (test 8)", () => {
  it("rejects requests beyond the write limit with HTTP 429", async () => {
    const express = (await import("express")).default;
    const { createWriteLimiter } = await import("../middleware/rateLimiter.js");

    const limiter = createWriteLimiter(2);
    const miniApp = express();
    miniApp.use(limiter);
    miniApp.post("/test", (_req, res) => res.json({ ok: true }));

    const r1 = await request(miniApp).post("/test");
    const r2 = await request(miniApp).post("/test");
    const r3 = await request(miniApp).post("/test"); // should be rejected

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body).toMatchObject({ error: expect.stringContaining("Too many requests") });
  });

  it("rejects requests beyond the chain-status limit with HTTP 429", async () => {
    const express = (await import("express")).default;
    const { createChainStatusLimiter } = await import("../middleware/rateLimiter.js");

    const limiter = createChainStatusLimiter(2);
    const miniApp = express();
    miniApp.use(limiter);
    miniApp.get("/chain-status", (_req, res) => res.json({ ok: true }));

    const r1 = await request(miniApp).get("/chain-status");
    const r2 = await request(miniApp).get("/chain-status");
    const r3 = await request(miniApp).get("/chain-status");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
  });

  it("read limiter allows requests up to the limit then rejects", async () => {
    const express = (await import("express")).default;
    const { createReadLimiter } = await import("../middleware/rateLimiter.js");

    const limiter = createReadLimiter(3);
    const miniApp = express();
    miniApp.use(limiter);
    miniApp.get("/read", (_req, res) => res.json({ ok: true }));

    const results = await Promise.all(
      Array.from({ length: 4 }, () => request(miniApp).get("/read")),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(3);
    expect(statuses).toContain(429);
  });

  it("503 is returned when OPERATOR_API_KEY is unset (fails closed for misconfiguration)", async () => {
    const express = (await import("express")).default;
    const { requireRole } = await import("../middleware/auth.js");

    const miniApp = express();
    const guard = requireRole("OPERATOR");
    miniApp.get("/protected", guard, (_req, res) => res.json({ ok: true }));

    const saved = process.env.OPERATOR_API_KEY;
    delete process.env.OPERATOR_API_KEY;
    try {
      // Must send SOME token so the middleware reaches the 503 check.
      // Requests with no token return 401 before the config check.
      const res = await request(miniApp)
        .get("/protected")
        .set("Authorization", "Bearer any-dummy-token");
      expect(res.status).toBe(503);
    } finally {
      if (saved !== undefined) process.env.OPERATOR_API_KEY = saved;
    }
  });
});
