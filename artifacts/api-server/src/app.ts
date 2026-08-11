import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { readLimiter } from "./middleware/rateLimiter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

/**
 * Build the CORS origin list for this environment.
 *
 * Development  : all origins allowed (convenience for local tooling).
 * Production   : explicit allowlist only.
 *   1. `ALLOWED_ORIGINS` env var (comma-separated) — operator-supplied origins.
 *   2. `REPLIT_DOMAINS` env var — the deployment domain set automatically by
 *      the Replit platform (e.g. "attached-assets--user.replit.app").
 *   If neither is set in production the list is empty and CORS is denied for
 *   all cross-origin requests (fail-closed). Same-origin frontend requests are
 *   unaffected because browsers do not send CORS preflight for same-origin.
 */
function buildCorsOptions(): cors.CorsOptions {
  if (!isProduction) {
    return { origin: true, credentials: true };
  }

  const explicitOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // REPLIT_DOMAINS is a comma-separated list of bare hostnames; prepend https://
  const replitOrigins = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((h) => `https://${h}`);

  const allowed = [...new Set([...explicitOrigins, ...replitOrigins])];

  if (allowed.length === 0) {
    logger.warn(
      "Production CORS: ALLOWED_ORIGINS and REPLIT_DOMAINS are both unset. " +
        "All cross-origin requests will be denied. " +
        "Set ALLOWED_ORIGINS to allowlist external consumers.",
    );
    return { origin: false };
  }

  logger.info({ allowed }, "Production CORS: allowlisted origins");
  return { origin: allowed, credentials: true };
}

const app: Express = express();

// Trust the first proxy hop so req.ip reflects the client IP (needed for
// accurate rate-limit keying behind Replit's reverse proxy).
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Strip query string to avoid leaking sensitive query params to logs.
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors(buildCorsOptions()));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Broad safety-net rate limiter applied to all /api routes (300 req/min).
// Individual write and expensive-read routes apply stricter secondary limits.
app.use("/api", readLimiter);
app.use("/api", router);

const frontendPath = path.join(__dirname, "../../trustion/dist/public");
app.use(express.static(frontendPath));
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

export default app;
