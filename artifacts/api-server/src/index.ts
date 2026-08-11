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
  _setActiveKeyId,
} from "./lib/crypto";

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
}

startServer().catch((err) => {
  logger.error({ err }, "Unexpected error during server startup.");
  process.exit(1);
});
