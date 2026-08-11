/**
 * Unit tests: role-based authentication and authorization middleware
 *
 * Exercises requireRole() and resolveIdentity() in isolation using a minimal
 * Express app that never touches the database.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { requireRole, resolveIdentity, deriveSubject } from "../middleware/auth.js";

// ─── Test credentials ─────────────────────────────────────────────────────────

const OPERATOR_KEY    = "test-operator-key-abc123";
const AUDITOR_KEY     = "test-auditor-key-xyz789";
const ADMIN_KEY       = "test-admin-key-qrs456";
const EDGE_INGEST_KEY = "test-edge-ingest-key-mno321";

// ─── Environment helpers ──────────────────────────────────────────────────────

function setCredentials(overrides: Partial<Record<
  "OPERATOR_API_KEY" | "AUDITOR_API_KEY" | "ADMIN_API_KEY" | "EDGE_INGEST_API_KEY",
  string | undefined
>>) {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function setAllCredentials() {
  return setCredentials({
    OPERATOR_API_KEY:    OPERATOR_KEY,
    AUDITOR_API_KEY:     AUDITOR_KEY,
    ADMIN_API_KEY:       ADMIN_KEY,
    EDGE_INGEST_API_KEY: EDGE_INGEST_KEY,
  });
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Public route
  app.get("/public", (_req, res) => res.json({ public: true }));

  // OPERATOR-only route that echoes auth context
  app.get("/operator-only", requireRole("OPERATOR"), (req, res) => {
    res.json({ subject: req.auth!.subject, role: req.auth!.role });
  });

  // AUDITOR-only route
  app.get("/auditor-only", requireRole("AUDITOR"), (req, res) => {
    res.json({ subject: req.auth!.subject, role: req.auth!.role });
  });

  // ADMIN-only route
  app.get("/admin-only", requireRole("ADMIN"), (req, res) => {
    res.json({ subject: req.auth!.subject, role: req.auth!.role });
  });

  // EDGE_INGEST-only route
  app.post("/edge-only", requireRole("EDGE_INGEST"), (req, res) => {
    res.json({ subject: req.auth!.subject, role: req.auth!.role });
  });

  // Multi-role route (OPERATOR or ADMIN)
  app.post("/operator-or-admin", requireRole("OPERATOR", "ADMIN"), (req, res) => {
    res.json({ subject: req.auth!.subject, role: req.auth!.role });
  });

  // Route that echoes server-derived identity vs caller-supplied field
  app.patch("/acknowledge", requireRole("OPERATOR", "ADMIN"), (req, res) => {
    const serverDerived = req.auth!.subject;
    res.json({
      acknowledgedBy: serverDerived,
      callerSupplied: req.body.acknowledgedBy ?? null,
    });
  });

  // Route simulating auditor decision: verifierId must come from auth context
  app.post("/auditor-decision", requireRole("AUDITOR"), (req, res) => {
    const verifierId = req.auth!.subject; // never from req.body
    res.json({
      verifierId,
      callerVerifierId: req.body.verifierId ?? null,
    });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("requireRole — fail-closed for missing credentials (503)", () => {
  let restore: () => void;
  afterEach(() => restore?.());

  it("returns 503 when no credentials are configured for the required role", async () => {
    restore = setCredentials({ OPERATOR_API_KEY: undefined });
    const app = buildTestApp();
    // Must send SOME token — the middleware reaches the 503 check only after
    // confirming a token was presented.  No-token requests return 401.
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", "Bearer any-dummy-token");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: expect.stringContaining("not configured") });
  });

  it("does NOT 503 when at least one of the allowed roles has a credential", async () => {
    // OPERATOR configured, ADMIN not — route allows both
    restore = setCredentials({
      OPERATOR_API_KEY: OPERATOR_KEY,
      ADMIN_API_KEY: undefined,
    });
    const app = buildTestApp();
    const res = await request(app)
      .post("/operator-or-admin")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(res.status).toBe(200);
  });
});

describe("requireRole — unauthenticated requests (401)", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("returns 401 when no Authorization header is present", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/operator-only");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is empty", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/operator-only").set("Authorization", "");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a Bearer token not matching any known credential", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", "Bearer completely-unknown-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a bare (non-Bearer) unknown token", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", "random-garbage");
    expect(res.status).toBe(401);
  });
});

describe("requireRole — wrong role for endpoint (403)", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("returns 403 when AUDITOR credential is used on an OPERATOR-only route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", `Bearer ${AUDITOR_KEY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/AUDITOR.*not authorized|not authorized.*AUDITOR/i);
  });

  it("returns 403 when OPERATOR credential is used on an AUDITOR-only route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/auditor-only")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when ADMIN credential is used on an AUDITOR-only route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/auditor-only")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when EDGE_INGEST credential is used on an OPERATOR-only route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", `Bearer ${EDGE_INGEST_KEY}`);
    expect(res.status).toBe(403);
  });

  it("403 body names the rejected role so the caller understands why", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("ADMIN");
  });
});

describe("requireRole — authorized requests (200) and subject format", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("OPERATOR credential on OPERATOR route → 200 with correct role", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("OPERATOR");
  });

  it("AUDITOR credential on AUDITOR route → 200 with correct role", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/auditor-only")
      .set("Authorization", `Bearer ${AUDITOR_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("AUDITOR");
  });

  it("ADMIN credential on ADMIN route → 200 with correct role", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/admin-only")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
  });

  it("EDGE_INGEST credential on EDGE_INGEST route → 200 with correct role", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/edge-only")
      .set("Authorization", `Bearer ${EDGE_INGEST_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("EDGE_INGEST");
  });

  it("subject follows '<role_lower>:<16 hex chars>' format", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.subject).toMatch(/^operator:[0-9a-f]{16}$/);
  });

  it("subject contains the role prefix for each role", async () => {
    const app = buildTestApp();

    const opRes = await request(app).get("/operator-only").set("Authorization", `Bearer ${OPERATOR_KEY}`);
    const auRes = await request(app).get("/auditor-only").set("Authorization", `Bearer ${AUDITOR_KEY}`);
    const adRes = await request(app).get("/admin-only").set("Authorization", `Bearer ${ADMIN_KEY}`);
    const edRes = await request(app).post("/edge-only").set("Authorization", `Bearer ${EDGE_INGEST_KEY}`);

    expect(opRes.body.subject).toMatch(/^operator:/);
    expect(auRes.body.subject).toMatch(/^auditor:/);
    expect(adRes.body.subject).toMatch(/^admin:/);
    expect(edRes.body.subject).toMatch(/^edge_ingest:/);
  });

  it("same credential always produces the same subject (deterministic)", async () => {
    const app = buildTestApp();
    const r1 = await request(app).get("/operator-only").set("Authorization", `Bearer ${OPERATOR_KEY}`);
    const r2 = await request(app).get("/operator-only").set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(r1.body.subject).toBe(r2.body.subject);
  });

  it("different credentials produce different subjects", async () => {
    const app = buildTestApp();
    const opRes = await request(app).get("/operator-only").set("Authorization", `Bearer ${OPERATOR_KEY}`);
    // Derive what auditor would be, via deriveSubject
    const auditorSubject = deriveSubject("AUDITOR", AUDITOR_KEY);
    expect(opRes.body.subject).not.toBe(auditorSubject);
  });

  it("OPERATOR credential works on a multi-role (OPERATOR|ADMIN) route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/operator-or-admin")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("OPERATOR");
  });

  it("ADMIN credential works on a multi-role (OPERATOR|ADMIN) route", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/operator-or-admin")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("ADMIN");
  });

  it("accepts bare token (without Bearer prefix) if it matches", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/operator-only")
      .set("Authorization", OPERATOR_KEY);
    expect(res.status).toBe(200);
  });
});

describe("requireRole — caller-supplied identity cannot escalate privileges", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("acknowledgedBy in response is server-derived, never the caller-supplied body value", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .patch("/acknowledge")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`)
      .send({ acknowledgedBy: "attacker-supplied-identity" });

    expect(res.status).toBe(200);
    expect(res.body.acknowledgedBy).toMatch(/^operator:[0-9a-f]{16}$/);
    expect(res.body.acknowledgedBy).not.toBe("attacker-supplied-identity");
    expect(res.body.callerSupplied).toBe("attacker-supplied-identity"); // received but ignored
  });

  it("verifierId in auditor decision is server-derived, not from request body", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/auditor-decision")
      .set("Authorization", `Bearer ${AUDITOR_KEY}`)
      .send({ verifierId: "operator:fake-escalation-attempt" });

    expect(res.status).toBe(200);
    expect(res.body.verifierId).toMatch(/^auditor:[0-9a-f]{16}$/);
    expect(res.body.verifierId).not.toBe("operator:fake-escalation-attempt");
  });

  it("credential with correct role but injected Authorization body field → role from credential only", async () => {
    // Even if the request somehow includes a 'role' field in the body, the role
    // in req.auth must come from the server-side credential resolution only.
    const app = buildTestApp();
    const res = await request(app)
      .patch("/acknowledge")
      .set("Authorization", `Bearer ${OPERATOR_KEY}`)
      .send({ role: "AUDITOR", acknowledgedBy: "auditor:fake" });

    expect(res.status).toBe(200);
    // Subject is still derived from the OPERATOR key, not the injected role
    expect(res.body.acknowledgedBy).toMatch(/^operator:/);
  });
});

describe("resolveIdentity — direct unit tests", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("returns OPERATOR role for the OPERATOR key", () => {
    const id = resolveIdentity(OPERATOR_KEY);
    expect(id).not.toBeNull();
    expect(id!.role).toBe("OPERATOR");
    expect(id!.subject).toMatch(/^operator:[0-9a-f]{16}$/);
  });

  it("returns AUDITOR role for the AUDITOR key", () => {
    const id = resolveIdentity(AUDITOR_KEY);
    expect(id!.role).toBe("AUDITOR");
    expect(id!.subject).toMatch(/^auditor:[0-9a-f]{16}$/);
  });

  it("returns ADMIN role for the ADMIN key", () => {
    const id = resolveIdentity(ADMIN_KEY);
    expect(id!.role).toBe("ADMIN");
    expect(id!.subject).toMatch(/^admin:[0-9a-f]{16}$/);
  });

  it("returns EDGE_INGEST role for the EDGE_INGEST key", () => {
    const id = resolveIdentity(EDGE_INGEST_KEY);
    expect(id!.role).toBe("EDGE_INGEST");
    expect(id!.subject).toMatch(/^edge_ingest:[0-9a-f]{16}$/);
  });

  it("returns null for an unknown token", () => {
    expect(resolveIdentity("not-a-configured-key")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveIdentity("")).toBeNull();
  });

  it("credential hash in subject does not contain the key itself", () => {
    const id = resolveIdentity(OPERATOR_KEY)!;
    const hash = id.subject.split(":")[1];
    expect(hash).not.toBe(OPERATOR_KEY);
    expect(hash).not.toBe(OPERATOR_KEY.slice(0, 16));
  });
});

describe("Public routes are unaffected by auth middleware", () => {
  let restore: () => void;
  beforeEach(() => { restore = setAllCredentials(); });
  afterEach(() => restore());

  it("GET /public returns 200 with no credentials", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/public");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ public: true });
  });
});
