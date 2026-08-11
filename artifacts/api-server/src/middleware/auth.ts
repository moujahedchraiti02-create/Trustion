import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Shape attached to the request after successful authentication.
 */
export interface AuthContext {
  /** Stable identifier for the authenticated caller, derived server-side. */
  subject: string;
}

/** Extend Express Request so downstream handlers can read `req.auth`. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const MISSING_KEY_MSG =
  "API_KEY environment variable is not configured. " +
  "Set it as a Replit Secret before starting the server.";

/**
 * Middleware that enforces API-key authentication on a route.
 *
 * Callers must send:
 *   Authorization: Bearer <API_KEY value>
 *
 * On success the request continues with `req.auth` populated.
 * On failure the request is terminated with 401 or 503.
 */
export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configuredKey = process.env.API_KEY;

  // Fail-closed: if the server is misconfigured, refuse all requests.
  if (!configuredKey) {
    logger.error(MISSING_KEY_MSG);
    res.status(503).json({ error: "Service authentication not configured." });
    return;
  }

  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!token || token !== configuredKey) {
    res.status(401).json({ error: "Unauthorized: valid API key required." });
    return;
  }

  // Attach a server-derived identity so downstream handlers never trust
  // caller-supplied identity strings.
  req.auth = { subject: "Authorized Operator" };
  next();
}
