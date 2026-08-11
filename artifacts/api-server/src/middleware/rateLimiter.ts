import { rateLimit, type Options } from "express-rate-limit";

const JSON_429 = { error: "Too many requests. Please try again later." };

/**
 * Factory so tests can create low-limit instances without touching production
 * configuration. Production uses the pre-built exports below.
 */
export function createReadLimiter(limit = 300): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: JSON_429,
    // req.ip is reliable after app.set('trust proxy', 1)
  } satisfies Partial<Options>);
}

export function createWriteLimiter(limit = 30): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: JSON_429,
  } satisfies Partial<Options>);
}

export function createChainStatusLimiter(limit = 10): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: JSON_429,
  } satisfies Partial<Options>);
}

/** Broad safety-net on all /api routes (300 req/min by default). */
export const readLimiter = createReadLimiter();

/** Stricter limit applied to every state-mutating endpoint (30 req/min). */
export const writeLimiter = createWriteLimiter();

/**
 * Very strict limit for GET /ledger/chain-status: the handler recomputes
 * SHA-256 hashes over every entry in the ledger on every call.
 */
export const chainStatusLimiter = createChainStatusLimiter();
