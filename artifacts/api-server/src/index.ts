import app from "./app";
import { logger } from "./lib/logger";
import { initRegistry } from "./lib/crypto";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Load historical signing key entries from DB into the in-memory registry.
  // This makes verifyPayloadByKeyId() work for entries signed under past keys.
  initRegistry().catch((e) =>
    logger.error({ err: e }, "Failed to initialise signing key registry from DB"),
  );
});
