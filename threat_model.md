# Threat Model

## Project Overview

S³V TRUSTION is a sovereign maritime carbon evidence ledger. It ingests, cryptographically signs, and chain-hashes vessel telemetry (engine load, fuel consumption, GPS position, emissions) for regulatory compliance under FuelEU Maritime and IMO DCS standards. Users include fleet operators and external auditors. Tech stack: Node.js 24 / Express 5 / TypeScript, React 18 / Vite frontend, PostgreSQL + Drizzle ORM. Deployed as a public autoscale Replit deployment.

## Assets

- **Ledger integrity** — Append-only, Merkle-chained, Ed25519-signed telemetry records. The central value proposition: tamper-evident regulatory evidence. Compromise allows injection of falsified emission data.
- **Auditor decisions** — Formal verdicts (APPROVED / FLAGGED / PENDING) stored against vessel evidence packages. Forgery could falsify regulatory audit outcomes.
- **Emissions and compliance data** — CO₂, CH₄, N₂O measurements and derived compliance metrics (CII, FuelEU). Contains commercially sensitive vessel performance data.
- **Vessel registry** — IMO numbers, vessel names, flag states, reporting year. PII-adjacent business data.
- **Regulatory profiles** — Versioned FuelEU/IMO DCS parameters governing compliance calculations. Tampering changes what counts as compliant.
- **Ed25519 signing key** — Private key used to sign every ledger entry. Loss or compromise breaks all signature verification.

## Trust Boundaries

- **Public Internet → Express API**: All `/api/*` routes. Currently **no authentication boundary exists** — any internet user is treated as trusted. This is the primary vulnerability.
- **Express API → PostgreSQL**: Application layer has full read/write access. Drizzle ORM with parameterized queries prevents SQL injection. No row-level security at the DB layer.
- **Server → Ed25519 key material**: `ED25519_SECRET_KEY_HEX` env var (optional, falls back to ephemeral). Compromise of the key allows forging valid signatures for any payload.
- **Browser → API (CORS)**: CORS is wildcard (`*`), allowing any origin to issue API requests and read responses.

## Scan Anchors

- **Production entry point**: `artifacts/api-server/src/app.ts` — Express app, all routes under `/api`
- **Highest-risk routes**: `POST /api/ledger/entries`, `POST /api/auditor/decisions`, `PATCH /api/alerts/:id/acknowledge`, `POST /api/regulatory-profiles`
- **Cryptographic logic**: `artifacts/api-server/src/lib/crypto.ts` — Ed25519 signing, chain hash, Merkle proof
- **All routes**: `artifacts/api-server/src/routes/` — vessels, ledger, emissions, regulatory, alerts, auditor, dashboard
- **DB schema**: `lib/db/src/schema/` — ledgerEntries, auditorDecisions, vessels, alerts, emissions, regulatoryProfiles
- **Frontend (SPA)**: `artifacts/trustion/src/` — read-only display, no server-side logic; dev-only mockup at `artifacts/mockup-sandbox/`
- **Dev-only areas**: `artifacts/mockup-sandbox/` (Canvas/design mockup), `artifacts/trustion-deck/` (slides), `.local/skills/`

## Threat Categories

### Spoofing

All API endpoints are unauthenticated. Any internet caller can impersonate an operator, auditor, or system component. The `acknowledgedBy` field in alert acknowledgement is caller-supplied, allowing identity fabrication in the audit trail. **Required guarantee: all write endpoints and auditor endpoints MUST require a verified identity before accepting input.**

### Tampering

With no authentication, the append-only ledger can be polluted with arbitrary forged entries via `POST /api/ledger/entries`. The server computes a valid chain hash for each accepted entry, integrating forgeries seamlessly into the Merkle chain. Regulatory profiles can be created by anyone, altering compliance calculations. **Required guarantee: ledger ingestion MUST authenticate the submitting device or operator; regulatory profile changes MUST require admin authorization.**

### Repudiation

Alert acknowledgements store a free-text `acknowledgedBy` field supplied by the caller — not derived from an authenticated session. This means the audit trail of who suppressed a LEGAL_WARNING is meaningless and deniable. **Required guarantee: `acknowledgedBy` MUST be populated from the authenticated session identity.**

### Information Disclosure

All data (vessel positions, emissions, audit packages, chain hashes, public keys) is readable by any internet user. The auditor evidence endpoint (`GET /api/auditor/evidence/:vesselId`) is explicitly intended for authorized auditors but has no access control. CORS wildcard allows any website to read API responses. **Required guarantee: sensitive endpoints MUST require authentication; auditor endpoints MUST require auditor role.**

### Denial of Service

No rate limiting exists. The chain-integrity check endpoint (`GET /api/ledger/chain-status`) recomputes hashes for all ledger entries on every call. The `limit` query parameter on `/api/ledger/entries` has no server-enforced maximum, allowing arbitrarily large single-query extractions. **Required guarantee: rate limiting MUST be applied to all public endpoints; query limits MUST be capped server-side.**

### Elevation of Privilege

The signing key falls back to an ephemeral per-process key when `ED25519_SECRET_KEY_HEX` is unset. On an autoscale deployment, each instance generates a different key, and each restart discards the previous key. This silently breaks the ability to verify signatures on all previously-ingested entries, undermining regulatory audit integrity. **Required guarantee: `ED25519_SECRET_KEY_HEX` MUST be provisioned as a persistent, stable secret before production use.**
