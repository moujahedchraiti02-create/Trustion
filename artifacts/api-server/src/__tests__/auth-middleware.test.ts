/**
 * Security tests: authentication middleware
 *
 * These tests exercise requireApiKey in isolation using a minimal Express app
 * that does NOT import the database.  No mocking of Drizzle is needed here.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { requireApiKey } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Minimal test app — a single protected GET and a single public GET
// ---------------------------------------------------------------------------
function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Public route — intentionally unprotected
  app.get("/public", (_req, res) => {
    res.json({ public: true });
  });

  // Protected route — reflects the server-derived auth context
  app.get("/protected", requireApiKey, (req, res) => {
    res.json({ subject: req.auth!.subject });
  });

  // Protected write route that demonstrates acknowledgedBy cannot be overridden
  app.patch("/protected/acknowledge", requireApiKey, (req, res) => {
    // The route always derives identity from the auth context — never from the
    // body.  This mirrors the production alerts PATCH implementation.
    const acknowledgedBy = req.auth!.subject;
    res.json({ acknowledgedBy, bodyValue: req.body.acknowledgedBy ?? null });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_KEY = "test-api-key-abc123";

function withKey(key: string | undefined) {
  const original = process.env.API_KEY;
  if (key === undefined) {
    delete process.env.API_KEY;
  } else {
    process.env.API_KEY = key;
  }
  return () => {
    if (original === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = original;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("requireApiKey middleware", () => {
  let restore: () => void;

  afterEach(() => {
    restore?.();
  });

  // ─── Test 1: API_KEY not configured → 503 ────────────────────────────────
  it("returns 503 when API_KEY env var is not configured", async () => {
    restore = withKey(undefined);
    const app = buildTestApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  // ─── Test 2: missing credential → 401 ────────────────────────────────────
  it("returns 401 when no Authorization header is sent", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Unauthorized") });
  });

  // ─── Test 3: invalid credential → 401 ────────────────────────────────────
  it("returns 401 when the wrong API key is supplied", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer wrong-key");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Unauthorized") });
  });

  it("returns 401 when a bare (non-Bearer) wrong token is supplied", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "wrong-key");
    expect(res.status).toBe(401);
  });

  // ─── Test 4: valid credential → authorized operation succeeds ─────────────
  it("allows the request and populates req.auth when a valid key is supplied", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer ${VALID_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: "Authorized Operator" });
  });

  it("accepts a bare token (without Bearer prefix) matching the configured key", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app)
      .get("/protected")
      .set("Authorization", VALID_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: "Authorized Operator" });
  });

  // ─── Test 5: caller-supplied acknowledgedBy cannot override server identity ──
  it("derives acknowledgedBy from req.auth — caller-supplied value is ignored", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();

    // Send an attacker-controlled identity in the request body
    const res = await request(app)
      .patch("/protected/acknowledge")
      .set("Authorization", `Bearer ${VALID_KEY}`)
      .send({ acknowledgedBy: "attacker-supplied-identity" });

    expect(res.status).toBe(200);
    // Server-derived identity is used
    expect(res.body.acknowledgedBy).toBe("Authorized Operator");
    // The body value was received but NOT used for the stored field
    expect(res.body.bodyValue).toBe("attacker-supplied-identity");
    expect(res.body.acknowledgedBy).not.toBe("attacker-supplied-identity");
  });

  // ─── Public route is unaffected ──────────────────────────────────────────
  it("does not protect public routes — /public responds 200 with no credentials", async () => {
    restore = withKey(VALID_KEY);
    const app = buildTestApp();
    const res = await request(app).get("/public");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ public: true });
  });
});
