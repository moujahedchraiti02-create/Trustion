---
name: Signing Key Rotation (Task #10)
description: Architecture and limitations of the key registry + rotation system implemented for S³V TRUSTION.
---

## Key ID vs Fingerprint
- `key_id` = SHA-256(publicKey bytes) as 64 hex chars → stable, unique, stored on ledger entries.
- `fingerprint` = first 16 hex chars of `key_id` → used only in startup/rotation log lines.
- They are distinct by design. Do NOT confuse them.

## Registry architecture
- In-memory `Map<keyId, KeyRegistryEntry>` in `lib/keyRegistry.ts` (sync reads).
- Async fire-and-forget DB persistence to `signing_key_registry` table.
- `initRegistry()` called after `app.listen()` to repopulate map from DB on restart.
- At-most-one-ACTIVE invariant enforced in `registerKey()`.

## Status model
- ACTIVE → signs new evidence.
- RETIRED → no new signing; historical verification still works.
- REVOKED → no new signing; `_activeKeyId` set to null; DB record + reason preserved permanently. Cannot be re-activated.

## Rotation model
- `rotateSigningKey(newKeyHex)` in `crypto.ts`: retires current, registers new, updates `_signingKeyPair`/`_activeKeyId`.
- Only in-memory. For persistence across restarts, also update `ED25519_SECRET_KEY_HEX` env var.
- Key A retired → history still verifiable using stored publicKey or `verifyPayloadByKeyId(keyId_A)`.

## `signPayload()` now returns `keyId`
- Return value: `{ signature, publicKey, keyId }`.
- Callers in `ledger.ts` destructure all three and store `keyId` in the DB.
- Any test asserting exactly 2 keys must be updated to expect 3.

## Route security
- `GET /api/key-registry` → public (no auth).
- `POST /api/key-registry/rotate|retire|revoke` → ADMIN role required.

## Test isolation
- `_reinitForTesting(keyHex)` in `crypto.ts`: clears registry, re-inits with given key.
- DB mocks need `onConflictDoNothing: () => chain` on the chain object.
- DB mock exports need `signingKeyRegistryTable: { keyId: {} }`.

**Why:** Historical verifiability is a hard regulatory requirement (FuelEU Maritime / IMO DCS). Revoked keys cannot disappear from the DB.
