/**
 * Server entry point.
 *
 * Startup order (enforced — server does not listen until all steps succeed):
 *   1. Load Ed25519 signing identity from ED25519_SECRET_KEY_HEX (module load).
 *   2. Apply DB partial-unique-index constraint + atomically activate registry
 *      identity in a single transaction (initRegistryAndActivate).
 *      → Fails closed: if the env key is REVOKED, if the DB is unreachable, or
 *        if any invariant is violated, the process exits before binding a port.
 *   3. Set _activeKeyId in the signing module so signPayload() is live.
 *   4. app.listen() — server begins accepting requests.
 *
 * This ordering guarantees that no ledger evidence can be signed before the
 * registry is consistent with the deployment secret.
 */
import app from "./app";
import { logger } from "./lib/logger";
import {
  signingPublicKeyHex,
  signingKeyFingerprint,
  signingMode,
  initRegistryAndActivate,
  checkAndAlertKeyExpiry,
  _setActiveKeyId,
} from "./lib/crypto";

/**
 * Interval for pre-expiry alert checks (default: 6 hours).
 * Override via SIGNING_KEY_EXPIRY_CHECK_INTERVAL_MS env var.
 */
const EXPIRY_CHECK_INTERVAL_MS =
  Number(process.env.SIGNING_KEY_EXPIRY_CHECK_INTERVAL_MS) || 6 * 60 * 60 * 1000;

/**
 * Optional signing key expiry deadline.
 * Set SIGNING_KEY_EXPIRES_AT to an ISO-8601 date string (e.g. "2027-06-01T00:00:00Z")
 * to enable pre-expiry alerts.  If unset or unparseable, no expiry is tracked.
 */
function parseSigningKeyExpiry(): Date | null {
  const raw = process.env.SIGNING_KEY_EXPIRES_AT;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    logger.warn({ raw }, "SIGNING_KEY_EXPIRES_AT is not a valid ISO-8601 date — ignoring.");
    return null;
  }
  return d;
}
const signingKeyExpiresAt = parseSigningKeyExpiry();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  // ── Step 2: Atomically activate signing key in registry (before listen) ──
  let activeKeyId: string;
  try {
    activeKeyId = await initRegistryAndActivate(
      signingPublicKeyHex,
      signingKeyFingerprint,
      signingMode,
      "system:startup",
      signingKeyExpiresAt,
    );
  } catch (err) {
    logger.error(
      { err },
      "[FATAL] Signing key registry initialisation failed. " +
        "The server will not start. Investigate the error above and either " +
        "fix the database connectivity or rotate the signing key.",
    );
    process.exit(1);
  }

  // ── Step 3: Enable signing (safe now that DB is consistent) ──────────────
  _setActiveKeyId(activeKeyId);

  // ── Step 4: Begin accepting requests ─────────────────────────────────────
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port, activeKeyId }, "Server listening. Signing key registry ready.");
  });

  // ── Step 5: Start pre-expiry alert scheduler ─────────────────────────────
  // Run once immediately on startup, then on a periodic interval.
  // Silently skips if no expiresAt is configured for the active key.
  checkAndAlertKeyExpiry().catch((err) =>
    logger.error({ err }, "Pre-expiry alert check failed at startup."),
  );
  setInterval(() => {
    checkAndAlertKeyExpiry().catch((err) =>
      logger.error({ err }, "Pre-expiry alert check failed."),
    );
  }, EXPIRY_CHECK_INTERVAL_MS).unref(); // .unref() so the interval doesn't block process exit
}

startServer().catch((err) => {
  logger.error({ err }, "Unexpected error during server startup.");
  process.exit(1);
});
