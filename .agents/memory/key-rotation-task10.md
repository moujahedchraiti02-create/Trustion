---
name: Signing Key Rotation — Task #10 security hardening
description: Architecture decisions and implementation constraints for the key rotation & historical verification system.
---

## Core constraints

- `rotateSigningKey(newKeyHex)` is **permanently removed**. The only rotation path is: update `ED25519_SECRET_KEY_HEX` secret → restart → atomic DB activation via `initRegistryAndActivate()`.
- No API endpoint ever accepts private key material. `POST /api/key-registry/rotate` was removed in the hardening pass.
- `_activeKeyId` starts as `null` at module load. `signPayload()` throws until `initRegistryAndActivate()` completes and the caller calls `_setActiveKeyId(keyId)`. This is the "startup before listen" invariant at code level.

## Key API shape

- `initRegistryAndActivate(pubKeyHex, fingerprint, signingMode, actor?)` → `Promise<string>` (keyId)
  - Must be awaited before `app.listen()`.
  - Throws (fails closed) on any DB transaction failure, REVOKED key, or other anomaly.
  - Idempotent: safe to call on restart when the same key is already ACTIVE.
  - After resolve, caller calls `_setActiveKeyId(keyId)` to allow signing.
- `signPayload(payload)` → `{ signature, publicKey, keyId }` — 3 fields, no private material.
- `checkSignatureContext(payload, sig, keyId, verifyFn, signatureTimestamp?)` → `{ valid, keyStatus, revokedAt, signedBeforeRevocation }` for forensic auditor queries.
- `verifyPayloadByKeyId(payload, sig, keyId)` → `boolean` — raw crypto check, status check is caller's responsibility.

## DB schema additions

- `signing_key_registry`: added `revoked_at` column (distinct from `retired_at`). Both nullable; revoked key gets both set; retired-only key gets only `retired_at`.
- `signing_key_events`: new append-only table — KEY_ACTIVATED / KEY_RETIRED / KEY_REVOKED events with actor and reason.
- Partial unique index: `CREATE UNIQUE INDEX IF NOT EXISTS one_active_signing_key_idx ON signing_key_registry ((1)) WHERE status = 'ACTIVE'` — enforced at the DB level.

## revokedAt ≠ retiredAt

`revokedAt` is the forensic timestamp for `signedBeforeRevocation` comparisons. A key that is merely retired (rotation) has `revokedAt = null`. Only explicitly revoked keys (compromise, audit finding) get `revokedAt` set.

## Test helper exports (from `lib/crypto.ts`)

For tests that need to set up state without going through the DB:
- `_reinitForTesting(keyHex)` — clean slate, sets key pair + registry entry + activeKeyId (no DB).
- `_simulateRotationForTesting(newKeyHex)` — retires old ACTIVE in memory, activates new key (no DB), preserves history.
- `_clearRegistryForTesting()` — wipes in-memory map.
- `_setRegistryEntryForTesting(entry)` — set arbitrary entry in map.
- `_setActiveKeyId(keyId | null)` — directly set activeKeyId (null means signing blocked).
- `_loadRegistryFromDb()` — re-hydrate in-memory map from DB (use with DB mock for restart simulation).

**Why:** tests use these rather than calling `initRegistryAndActivate()` (which requires full DB mock setup) to avoid test complexity for in-memory behavioral tests.

## DB mock pattern for key-rotation tests

The `@workspace/db` mock must support:
- `db.execute()` → `{ rows: [] }` (CREATE INDEX calls)
- `db.transaction(cb)` → calls `cb(mockTx)` where `mockTx` has `execute()`, `select()`, `update()`, `insert()`
- `tx.execute()` → `{ rows: mockActiveRows }` (SELECT FOR UPDATE)
- `tx.select().from().where().limit(n)` → `mockExistingKeyRows.slice(0, n)` (key lookup)
- `db.select().from()` → `mockRegistryRows` (_loadRegistryFromDb after commit)
- Configurable `transactionThrows: boolean` for failure-mode tests

## Test counts

Final: **188 tests passing** across 5 test files (was 181 before hardening pass).

## Documented limitation

Zero-downtime rotation is not supported. Rotation requires a process restart. Documented in crypto.ts header comment.
