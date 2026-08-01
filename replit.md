# S³V TRUSTION

A sovereign maritime carbon evidence ledger — an edge-to-cloud forensic instrument for cryptographically verifiable vessel emissions compliance under FuelEU Maritime and IMO DCS standards.

## Run & Operate

- `pnpm --filter @workspace/trustion run dev` — run the frontend (port set by workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18 + Vite + Tailwind CSS (dark navy ops-center theme)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle tables: vessels, ledger_entries, emissions_records, regulatory_profiles, alerts, auditor_decisions
- `artifacts/api-server/src/routes/` — Express route handlers (dashboard, vessels, ledger, emissions, regulatory, alerts, auditor)
- `artifacts/api-server/src/lib/crypto.ts` — SHA-256 hashing, chain hash computation, Merkle proof builder
- `artifacts/trustion/src/pages/` — React pages (Dashboard, VesselsList, VesselDetail, LedgerList, LedgerDetail, EmissionsList, ProfilesList, AlertsList, AuditorGateway)
- `artifacts/trustion/src/index.css` — theme palette (dark navy, teal accent, JetBrains Mono for hashes)

## Architecture decisions

- **Append-only ledger model**: All ledger entries insert-only; no UPDATE/DELETE in the application layer. Chain hash links each entry to its predecessor, enabling Merkle proof construction.
- **Integer types as `number` in OpenAPI**: Orval v8 generates `zod.int()` for `type: integer` which conflicts with Zod v3. All integer fields use `type: number` in the spec; DB enforces integer constraints.
- **Temporal trust classification**: Computed server-side on ingest by comparing GNSS timestamp to server arrival time — TRUSTED_GNSS (< 5min drift), DRIFT_WARNING (5min–24h), BACKFILL (> 24h).
- **Role-based auditor separation**: Auditor decisions are submitted via append-only POST — never patching raw ledger data.
- **Hash seeding**: Seed data uses PostgreSQL's `md5()` for chain hashes (deterministic but illustrative). Production ingest uses Node.js `crypto.createHash('sha256')`.

## Product

S³V TRUSTION is a sovereign, field-deployed maritime carbon evidence ledger. It ingests, cryptographically signs, and chain-hashes vessel telemetry (engine load, fuel consumption, position, emissions). Key capabilities:

1. **Evidence Ledger** — Append-only, Merkle-chained, Ed25519/TPM2-signed telemetry records
2. **Temporal Trust Classification** — TRUSTED_GNSS / BACKFILL / DRIFT_WARNING per entry
3. **Multi-Gas Emissions Engine** — CO₂, CH₄, N₂O, CO₂e across WtW and TtW scopes
4. **Versioned Regulatory Profiles** — FuelEU, IMO DCS, MARPOL, CII parameters decoupled from code
5. **Materiality Guard** — WATCH / LEGAL_WARNING / THRESHOLD_EXCEEDED alert severity bands
6. **Auditor Gateway** — Read-only evidence packages + append-only verifier decisions

## User preferences

_None set yet._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml` — hooks and Zod schemas are generated; never hand-write them.
- Import all API hooks from `@workspace/api-client-react` (not `@workspace/api-client-react/api` — that subpath doesn't exist).
- Use `req.log` inside Express route handlers (not `console.log`); use the singleton `logger` for non-request contexts.
- `req.params.id` is `string | string[]` in Express 5 — always parse with `Array.isArray` guard + `parseInt`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
