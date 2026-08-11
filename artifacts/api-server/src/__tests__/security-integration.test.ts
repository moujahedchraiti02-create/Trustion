/**
 * Security integration tests
 *
 * Tests 6-8 from the Task-7 requirements:
 *   6. Public endpoints remain public only where explicitly intended.
 *   7. Pagination limits cannot exceed the server-side maximum.
 *   8. Rate limiting actually rejects excessive requests.
 *
 * The @workspace/db module is fully mocked so no real database is required.
 */
import { vi, describe, it, expect, beforeAll, afterEach } from "vitest";

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
const VALID_KEY = "integration-test-key";

function setKey(key: string | undefined) {
  if (key === undefined) delete process.env.API_KEY;
  else process.env.API_KEY = key;
}

// ─── Test 6: Public vs protected endpoint access ─────────────────────────────
describe("Public vs protected route access (test 6)", () => {
  beforeAll(() => setKey(VALID_KEY));
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

  // --- Protected auditor reads ---
  it("GET /api/auditor/evidence/:id requires authentication — 401 without key", async () => {
    const res = await request(app).get("/api/auditor/evidence/1");
    expect(res.status).toBe(401);
  });

  it("GET /api/auditor/decisions requires authentication — 401 without key", async () => {
    const res = await request(app).get("/api/auditor/decisions");
    expect(res.status).toBe(401);
  });

  // --- Protected write operations ---
  it("POST /api/ledger/entries requires authentication — 401 without key", async () => {
    const res = await request(app).post("/api/ledger/entries").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/vessels requires authentication — 401 without key", async () => {
    const res = await request(app).post("/api/vessels").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/regulatory-profiles requires authentication — 401 without key", async () => {
    const res = await request(app).post("/api/regulatory-profiles").send({});
    expect(res.status).toBe(401);
  });

  it("PATCH /api/alerts/:id/acknowledge requires authentication — 401 without key", async () => {
    const res = await request(app).patch("/api/alerts/1/acknowledge").send({});
    expect(res.status).toBe(401);
  });

  it("POST /api/auditor/decisions requires authentication — 401 without key", async () => {
    const res = await request(app).post("/api/auditor/decisions").send({});
    expect(res.status).toBe(401);
  });
});

// ─── Test 7: Pagination limit cap ────────────────────────────────────────────
describe("Pagination limit cap (test 7)", () => {
  beforeAll(() => setKey(VALID_KEY));
  afterEach(() => resetLimitCapture());

  it(`LEDGER_QUERY_MAX_LIMIT constant is defined and positive`, () => {
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
    // Build a minimal app with a very low write limit (2 per window) to avoid
    // needing to fire hundreds of real requests in a test.
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
    // At least the first 3 should succeed, the 4th should be 429
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(3);
    expect(statuses).toContain(429);
  });

  it("503 is returned when API_KEY is unset regardless of rate limit state", async () => {
    const express = (await import("express")).default;
    const { requireApiKey } = await import("../middleware/auth.js");

    const miniApp = express();
    miniApp.get("/protected", requireApiKey, (_req, res) => res.json({ ok: true }));

    const original = process.env.API_KEY;
    delete process.env.API_KEY;
    try {
      const res = await request(miniApp).get("/protected");
      expect(res.status).toBe(503);
    } finally {
      if (original !== undefined) process.env.API_KEY = original;
    }
  });
});
