/**
 * Role-based authentication and authorization middleware
 *
 * S³V TRUSTION Legal Firewall — identity and authorization model
 * ──────────────────────────────────────────────────────────────
 * Every protected route is guarded by an explicit, server-side authorization
 * check.  Authentication alone is not sufficient — the resolved role must be
 * among those explicitly permitted for the endpoint.
 *
 * Roles and credentials
 * ─────────────────────
 * OPERATOR     — vessel operators who submit fuel-consumption evidence
 *                and manage operational records.
 * AUDITOR      — independent third-party verifiers who read evidence
 *                packages and append regulatory decisions.
 * ADMIN        — configuration managers who manage vessels, regulatory
 *                profiles, and server configuration.  ADMINs do NOT
 *                automatically inherit AUDITOR authority — submitting
 *                auditor decisions requires the AUDITOR credential.
 * EDGE_INGEST  — IoT/edge-device credential restricted exclusively to
 *                evidence ingestion (POST /ledger/entries).
 *
 * Each role maps to a distinct environment secret.  Compromise of one
 * credential does not grant authority under any other role.
 *
 * Subject identity
 * ────────────────
 * On every successful authentication the middleware attaches a stable,
 * server-derived subject string to req.auth:
 *
 *   "<role>:<sha256(credential)[0..16]>"
 *   e.g. "auditor:782b218e85ab54ee"
 *
 * This identifier is:
 *   • Deterministic — same credential always produces the same subject.
 *   • Non-reversible — cannot reconstruct the key from the subject.
 *   • Non-secret — safe to log, store in auditor decisions, and include
 *     in alert acknowledgement records.
 *
 * Callers cannot supply or escalate their own role or identity string.
 * Even if a request body contains a field like { "verifierId": "..." }, route
 * handlers must always use req.auth!.subject when writing audit records.
 *
 * Current limitations (document for audit trail)
 * ───────────────────────────────────────────────
 * • Credentials are long-lived static secrets. No per-session token minting,
 *   expiry, or revocation mechanism exists.  Rotation requires replacing the
 *   environment secret and redeploying.
 * • A single credential per role is supported. Multiple operators or auditors
 *   cannot be distinguished beyond their shared role subject prefix.
 * • No production identity federation (OIDC, SAML, Okta) is implemented.
 *   All credentials are bearer tokens configured as Replit Secrets.
 * • Token transmission is protected only by TLS. No token binding or mutual
 *   TLS exists at this time.
 */

import { createHash } from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ─── Role type ────────────────────────────────────────────────────────────────

/**
 * The four recognized authorization roles.
 * Role assignment is always derived server-side from the credential —
 * callers cannot supply, claim, or escalate their own role.
 */
export type Role = "OPERATOR" | "AUDITOR" | "ADMIN" | "EDGE_INGEST";

// ─── AuthContext shape ────────────────────────────────────────────────────────

/**
 * Authentication and authorization context attached to req.auth after a
 * successful requireRole check.  Never populated by caller-supplied data.
 */
export interface AuthContext {
  /**
   * Stable, non-secret identifier derived server-side from the credential.
   * Format: "<role_lowercase>:<sha256(credential)[0..16]>"
   * Safe to log and store in audit records.
   */
  subject: string;
  /** The resolved role for this authenticated request. */
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ─── Credential registry ──────────────────────────────────────────────────────

/**
 * Maps each role to the name of its credential environment variable.
 * Changing a credential requires updating the Replit Secret and redeploying.
 */
const CREDENTIAL_ENV: Record<Role, string> = {
  OPERATOR:    "OPERATOR_API_KEY",
  AUDITOR:     "AUDITOR_API_KEY",
  ADMIN:       "ADMIN_API_KEY",
  EDGE_INGEST: "EDGE_INGEST_API_KEY",
};

// ─── Subject derivation ───────────────────────────────────────────────────────

/**
 * Derive a stable, non-secret subject identifier for an authenticated caller.
 *
 * Takes the first 16 hex characters of SHA-256(credential).
 * The resulting subject is deterministic (same key → same subject),
 * non-reversible, and safe to store in audit records.
 */
export function deriveSubject(role: Role, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `${role.toLowerCase()}:${hash}`;
}

// ─── Identity resolution ──────────────────────────────────────────────────────

/**
 * Resolve a bearer token against all known role credentials.
 *
 * Returns the authenticated role and server-derived subject if the token
 * matches any configured credential, or null if it does not match any.
 *
 * Exported so automated tests can exercise identity resolution directly
 * without spinning up an HTTP server.
 */
export function resolveIdentity(
  token: string,
): { role: Role; subject: string } | null {
  for (const [role, envVar] of Object.entries(CREDENTIAL_ENV) as [Role, string][]) {
    const key = process.env[envVar];
    if (key && token === key) {
      return { role, subject: deriveSubject(role, key) };
    }
  }
  return null;
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Middleware factory that enforces role-based authorization on a route.
 *
 * Fail-closed behavior:
 *
 *   Token absent or empty                   → 401 Unauthorized
 *   Token does not match any known cred     → 401 Unauthorized
 *   Token valid, role not in allowedRoles   → 403 Forbidden
 *   No credential configured for any of
 *     the allowed roles (misconfiguration)  → 503 Service Unavailable
 *   Authorized                              → req.auth populated; next()
 *
 * The 503 case means the server itself is misconfigured — the required role
 * credential is absent from the environment. This prevents silently open
 * routes in environments where secrets were not provisioned.
 *
 * @param allowedRoles  One or more roles permitted to access this route.
 */
export function requireRole(
  ...allowedRoles: Role[]
): (req: Request, res: Response, next: NextFunction) => void {
  if (allowedRoles.length === 0) {
    throw new Error("requireRole: at least one role must be specified.");
  }

  return function (req: Request, res: Response, next: NextFunction): void {
    // ── Extract token ─────────────────────────────────────────────────────
    const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      res.status(401).json({ error: "Unauthorized: authentication required." });
      return;
    }

    // ── Check at least one allowed credential is configured ───────────────
    // If none of the allowed role credentials exist in the environment, this
    // is a server misconfiguration — fail 503 rather than silently 401ing
    // all traffic.
    const anyConfigured = allowedRoles.some(
      (role) => !!process.env[CREDENTIAL_ENV[role]],
    );
    if (!anyConfigured) {
      const missingVars = allowedRoles.map((r) => CREDENTIAL_ENV[r]);
      logger.error(
        { missingEnvVars: missingVars, allowedRoles },
        "Service misconfiguration: no credentials configured for required roles.",
      );
      res.status(503).json({ error: "Service authentication not configured." });
      return;
    }

    // ── Resolve token to an identity ──────────────────────────────────────
    // We check against ALL roles, not just the allowed ones, so we can
    // distinguish "unknown credential" (401) from "wrong role" (403).
    const identity = resolveIdentity(token);

    if (!identity) {
      // Token does not match any configured credential.
      res.status(401).json({ error: "Unauthorized: unrecognized credential." });
      return;
    }

    // ── Enforce role authorization ────────────────────────────────────────
    if (!allowedRoles.includes(identity.role)) {
      logger.warn(
        {
          subject: identity.subject,
          role: identity.role,
          allowedRoles,
          method: req.method,
          path: req.path,
        },
        "Authorization denied: role not permitted for this endpoint.",
      );
      res.status(403).json({
        error: `Forbidden: the ${identity.role} role is not authorized to perform this action.`,
      });
      return;
    }

    // ── Authorized ────────────────────────────────────────────────────────
    req.auth = { subject: identity.subject, role: identity.role };
    next();
  };
}

// ─── Convenience pre-bound guards ────────────────────────────────────────────
// Use these for single-role endpoints. For endpoints that accept multiple
// roles, call requireRole(...roles) directly.

/** Requires the OPERATOR credential (vessel data submission, alert acknowledgement). */
export const requireOperator = requireRole("OPERATOR");

/** Requires the AUDITOR credential (evidence review, regulatory decisions). */
export const requireAuditor = requireRole("AUDITOR");

/** Requires the ADMIN credential (configuration management). */
export const requireAdmin = requireRole("ADMIN");

/** Requires the EDGE_INGEST credential (device-level evidence ingestion only). */
export const requireEdgeIngest = requireRole("EDGE_INGEST");
