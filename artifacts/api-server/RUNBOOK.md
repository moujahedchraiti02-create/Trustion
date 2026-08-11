# S³V TRUSTION — Signing Key Operator Runbook

**Audience:** Ship operators, port authority administrators, and compliance auditors  
**Last updated:** 2026-08-11  
**Scope:** Ed25519 signing key lifecycle — planned rotation, emergency revocation, startup failures, and historical evidence verification

---

## Table of Contents

1. [Background and Key Concepts](#1-background-and-key-concepts)
2. [Annual Planned Key Rotation](#2-annual-planned-key-rotation)
3. [Emergency Key Revocation](#3-emergency-key-revocation)
4. [Startup Failure Playbook](#4-startup-failure-playbook)
5. [Verifying Historical Evidence After Rotation or Revocation](#5-verifying-historical-evidence-after-rotation-or-revocation)
6. [Monitoring and Verification Endpoints](#6-monitoring-and-verification-endpoints)
7. [Security Constraints and Limitations](#7-security-constraints-and-limitations)
8. [Quick Reference](#8-quick-reference)

---

## 1. Background and Key Concepts

Every piece of evidence submitted to the TRUSTION ledger is signed with an Ed25519 private key. The corresponding public key and a stable **key_id** are stored alongside each ledger entry so any verifier can confirm the signature independently — even after the key has been rotated or retired.

### Key identifiers

| Term | Definition |
|---|---|
| `key_id` | SHA-256(public key bytes) as 64 lowercase hex chars. The stable, permanent identifier for a key. |
| `fingerprint` | First 16 hex chars of the `key_id`. Used in log lines. Never confused with the full `key_id`. |
| `publicKey` | Hex-encoded Ed25519 public key (32 bytes = 64 hex chars). Safe to expose and store. Never contains private material. |

### Key lifecycle states

```
(new key) ──► ACTIVE ──► RETIRED
                │
                └──────► REVOKED  (irreversible; stronger than RETIRED)
```

| Status | Meaning |
|---|---|
| `ACTIVE` | Currently signing new ledger entries. At most one key is ACTIVE at any time. |
| `RETIRED` | No longer signing, but historical signatures remain valid and verifiable. |
| `REVOKED` | Declared compromised. Historical signatures require scrutiny (see §5). A revoked key **cannot** be re-activated. |

### Signing modes

| Mode | When used |
|---|---|
| `PERSISTENT_ED25519` | Production. `ED25519_SECRET_KEY_HEX` is set as a Replit Secret. Key survives restarts. **Required for regulatory audit.** |
| `EPHEMERAL_DEV_ED25519` | Development/test only. A fresh key is generated per process start. Signatures **cannot** be verified after restart. |

---

## 2. Annual Planned Key Rotation

Rotation requires a brief server restart. There is no zero-downtime path in the current implementation. Schedule this during a maintenance window or low-traffic period.

> **Time estimate:** 2–5 minutes of signing interruption (server restart window).  
> **Effect on historical evidence:** None. All previously signed entries remain verifiable.

### Step 1 — Generate a new Ed25519 seed offline

Run this on a secure, offline machine or in a trusted terminal session:

```sh
node -e "const {sign}=require('tweetnacl'); \
  process.stdout.write(Buffer.from(sign.keyPair().secretKey.slice(0,32)).toString('hex')+'\n')"
```

This prints a 64-character hex string (32-byte seed). **Treat this as a secret.**  
Do not paste it into chat, email, or any log system.

### Step 2 — Update the Replit Secret

1. Open the Replit Secrets panel for the `api-server` artifact.
2. Update **`ED25519_SECRET_KEY_HEX`** with the 64-char hex seed from Step 1.
3. Do **not** restart the server yet — save the secret first.

### Step 3 — Restart the server

Restart the `artifacts/api-server: API Server` workflow in Replit.

On startup, `initRegistryAndActivate()` runs **before** the HTTP server accepts any requests and atomically:
- Locks the current ACTIVE key row in the database.
- Retires the previous ACTIVE key (`KEY_RETIRED` event appended).
- Activates the new key (`KEY_ACTIVATED` event appended).
- Hydrates the in-memory key registry from the database.

### Step 4 — Verify the logs

Immediately after restart, check the workflow logs. You should see these log lines in order:

```
Ed25519 persistent signing identity loaded and verified.
  { signingMode: "PERSISTENT_ED25519", keyFingerprint: "<16 hex chars>" }

Previous ACTIVE signing key retired during startup rotation.
  { retiredKeyId: "<old key_id>", actor: "system:startup" }

Signing key activated in registry.
  { keyId: "<new key_id>", fingerprint: "<16 hex chars>", signingMode: "PERSISTENT_ED25519", actor: "system:startup" }

Signing key registry ready.
```

If you see `signingMode: "EPHEMERAL_DEV_ED25519"` instead of `PERSISTENT_ED25519`, the secret was not saved correctly — repeat Steps 2–3.

### Step 5 — Confirm via API

```sh
curl -s https://<host>/api/key-registry | jq .
```

Expected response shape:

```json
{
  "activeKeyId": "<new 64-char key_id>",
  "totalKeys": 2,
  "entries": [
    {
      "keyId": "<old key_id>",
      "status": "RETIRED",
      "retiredAt": "2026-08-11T10:00:00.000Z",
      ...
    },
    {
      "keyId": "<new key_id>",
      "status": "ACTIVE",
      "activatedAt": "2026-08-11T10:00:00.000Z",
      ...
    }
  ]
}
```

Confirm:
- `activeKeyId` matches the new key.
- The old key appears with `status: "RETIRED"` and a non-null `retiredAt`.
- `signingMode` is `"PERSISTENT_ED25519"` on the new entry.

Also confirm the event log:

```sh
curl -s "https://<host>/api/key-registry/events" | jq '.events[0:4]'
```

You should see `KEY_RETIRED` (for the old key) and `KEY_ACTIVATED` (for the new key) as the most recent events.

---

## 3. Emergency Key Revocation

Use this procedure when the signing key is believed to be **compromised** (e.g., secret leaked, insider threat, system breach). Revocation is permanent and irreversible.

> **Important:** After revoking the active key, the server **cannot sign new evidence** until a replacement key is rotated in (Steps 1–4 of §2). Plan the replacement before or immediately after revoking.

### Step 1 — Revoke the active key via API

This endpoint requires the `ADMIN` role. Use your ADMIN API key:

```sh
curl -s -X POST https://<host>/api/key-registry/<key_id>/revoke \
  -H "Authorization: Bearer <ADMIN_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Key material compromised — detected in breach on 2026-08-11"}'
```

Replace `<key_id>` with the 64-char `key_id` from `GET /api/key-registry`.

**Expected response:**

```json
{
  "message": "Active signing key revoked. Server cannot sign new evidence. Update ED25519_SECRET_KEY_HEX and restart to restore signing capability.",
  "entry": {
    "keyId": "<key_id>",
    "status": "REVOKED",
    "revokedAt": "2026-08-11T10:05:00.000Z",
    "revocationReason": "Key material compromised — detected in breach on 2026-08-11",
    ...
  }
}
```

### Step 2 — Verify `revokedAt` is populated

```sh
curl -s https://<host>/api/key-registry | jq '.entries[] | select(.status == "REVOKED")'
```

Confirm:
- `status` is `"REVOKED"`.
- `revokedAt` is a non-null ISO 8601 timestamp.
- `revocationReason` matches what you submitted.
- `activeKeyId` in the top-level response is `null` (no key currently ACTIVE).

> **Note on the API response:** When revoking the currently ACTIVE key, the HTTP response body reads `"Key revoked. Historical records signed with this key are preserved."` — not the "Active signing key revoked…" variant. This is a known quirk: the route clears the in-memory active-key pointer before selecting the response message, so both code paths produce the same wording. Confirm the revocation by inspecting `GET /api/key-registry` (where `activeKeyId` will be `null`) and the event log rather than by relying on the response message text.

### Step 3 — Check the server log

You should see:

```
Active signing key revoked. Server cannot sign new evidence until
ED25519_SECRET_KEY_HEX is updated with a replacement key and the server is restarted.
  { keyId: "<key_id>", actor: "<your subject>", reason: "..." }
```

Any subsequent attempt to sign a new ledger entry will be rejected with HTTP 500 and the message:

> "Signing is not available: the signing key registry has not been initialised, or the active signing key has been revoked without a replacement."

### Step 4 — Advise auditors

Notify your compliance auditor with the following information:
- The revoked `key_id` and `fingerprint`.
- The `revokedAt` timestamp.
- The reason for revocation.
- The output of `GET /api/key-registry/events?keyId=<key_id>` showing the full lifecycle event log.

See §5 for how auditors should evaluate historical evidence after revocation.

### Step 5 — Rotate in a replacement key

Follow §2 immediately. The server will refuse to accept new evidence until a fresh ACTIVE key is in place.

> **Note:** If you attempt to restart the server with the same (now REVOKED) `ED25519_SECRET_KEY_HEX`, the server will exit at startup with:  
> `[FATAL] The signing key configured in ED25519_SECRET_KEY_HEX (key_id: ...) is flagged as REVOKED in the signing key registry.`  
> You must generate a new key and update the secret before restarting.

---

## 4. Startup Failure Playbook

The API server performs `initRegistryAndActivate()` before accepting any HTTP requests. If this step fails, the process exits with code 1 and signing does not begin. This is intentional fail-closed behaviour.

### Failure: "signing key registry failure" / process exits on startup

**Symptoms:** The workflow log shows an error and the process terminates. The server never reaches "Signing key registry ready."

**Diagnosis — check the log for one of these messages:**

---

**`[FATAL] The signing key configured in ED25519_SECRET_KEY_HEX ... is flagged as REVOKED`**

The secret contains a key that was previously revoked. A revoked key cannot be re-activated.

**Resolution:**
1. Generate a new Ed25519 seed (§2, Step 1).
2. Update `ED25519_SECRET_KEY_HEX` with the new seed.
3. Restart.

---

**`[FATAL] ED25519_SECRET_KEY_HEX is not configured`**

The secret is missing in production mode (`NODE_ENV=production`).

**Resolution:**
1. Generate a seed (§2, Step 1).
2. Add `ED25519_SECRET_KEY_HEX` to the Replit Secrets panel.
3. Restart.

---

**`ED25519_SECRET_KEY_HEX has wrong length`**

The secret value is malformed (wrong number of hex characters).

**Resolution:**
- A seed must be exactly 64 hex characters (32 bytes).
- A full secret key must be exactly 128 hex characters (64 bytes).
- Generate a fresh seed and update the secret.

---

**`Ed25519 signing key self-test failed`**

The derived key pair fails internal sign-then-verify. The key material is corrupt.

**Resolution:** Generate a new seed and update the secret.

---

**`Failed to commit DB transaction`** or any database-related error during startup

The registry transaction could not complete (DB unreachable, partial write, lock contention from a concurrent instance start).

**Resolution:**
1. Check that the PostgreSQL database is reachable and healthy.
2. If running multiple instances simultaneously, wait for one to complete startup before starting the next.
3. If the DB shows a partial state (e.g., a row with `status = 'ACTIVE'` from the old instance), the partial unique index `one_active_signing_key_idx` will prevent a second activation — this is correct behaviour. Investigate DB connectivity, then restart.

---

**Server starts but logs `EPHEMERAL_DEV_ED25519` in production**

This is not a startup failure, but it is a misconfiguration: the secret is not set and `NODE_ENV` is not `"production"`. Evidence signed in this mode **cannot** be verified after a restart.

**Resolution:** Set `ED25519_SECRET_KEY_HEX` in the Replit Secrets panel and restart.

---

### Idempotent restart (no key change)

If the server restarts with the same `ED25519_SECRET_KEY_HEX` as the previously ACTIVE key, you will see:

```
Signing key already ACTIVE in registry — idempotent restart.
  { keyId: "...", fingerprint: "...", actor: "system:startup" }
Signing key registry ready.
```

This is normal. No key transition occurs and no `KEY_RETIRED` event is emitted.

---

## 5. Verifying Historical Evidence After Rotation or Revocation

Historical ledger entries are **always** verifiable regardless of key lifecycle state, because each entry stores its own `publicKey`, `signature`, and `keyId`.

### Verifying a single entry offline

Each ledger entry contains:
- `publicKey` — hex-encoded Ed25519 public key used to sign it.
- `signature` — hex-encoded detached Ed25519 signature.
- `keyId` — 64-char SHA-256 of the public key (stable identifier).

To verify offline:
1. Retrieve the entry from the ledger API.
2. Canonicalise the payload using stable key-sorted JSON serialisation (same as the signing path).
3. Verify `signature` over the canonical payload using `publicKey` with standard Ed25519 verify (e.g., `tweetnacl`, `libsodium`, or OpenSSL).

The key does **not** need to be ACTIVE — the stored `publicKey` is sufficient.

### Checking key status for a historical entry

Use the registry API to look up a key's lifecycle:

```sh
curl -s "https://<host>/api/key-registry" | jq '.entries[] | select(.keyId == "<key_id>")'
```

| Field | Meaning for historical evidence |
|---|---|
| `status: "RETIRED"` | Key was cleanly rotated. All signatures remain valid and verifiable. |
| `status: "REVOKED"` | Key was declared compromised. All records signed under this key require auditor scrutiny. |
| `revokedAt` | ISO 8601 timestamp of revocation. |

**For revoked keys:** A valid cryptographic signature only proves that the private key was used to sign the payload — it does not prove *when* that signing occurred. The `timestampGnss` field on a ledger entry is evidence-supplied and may be set to any value by the submitter; the ingest path accepts backfills. An attacker who holds compromised key material can produce a syntactically valid signature after the compromise with an arbitrarily earlier claimed GNSS timestamp.

When evaluating records under a revoked key, auditors must **not** treat `timestampGnss < revokedAt` as proof that a signature was created before the compromise. Instead, corroborate the claimed event time with:
- Server-side receipt timestamps (ledger `createdAt` / ingest log timestamps recorded by the TRUSTION server, which the submitter cannot retroactively alter).
- Independent external records (port authority logs, AIS track data, satellite imagery) that corroborate the vessel's claimed position and event time.
- The event log (`GET /api/key-registry/events`) to confirm when the key was last known ACTIVE vs. when the revocation was recorded.

GNSS timestamps may be used as a supporting indicator, but alone they do not establish that a signature predates a compromise.

### Fetching the full event audit trail

```sh
curl -s "https://<host>/api/key-registry/events?keyId=<key_id>" | jq .
```

This returns the append-only forensic log for a specific key, including:
- `KEY_ACTIVATED` — when and by whom the key was activated.
- `KEY_RETIRED` — when the key was retired (normal rotation).
- `KEY_REVOKED` — when and why the key was revoked, with the actor recorded.

The event log is the authoritative forensic ground truth. The `entries` array in `GET /api/key-registry` reflects the current in-process cache.

---

## 6. Monitoring and Verification Endpoints

All read endpoints are public — no credentials required.

### `GET /api/key-registry`

Returns the current state of all keys in the registry.

```sh
curl -s https://<host>/api/key-registry | jq .
```

**Key fields to monitor:**
- `activeKeyId` — should be non-null in a healthy system.
- `entries[*].status` — look for unexpected `REVOKED` entries.
- `entries[*].signingMode` — should be `"PERSISTENT_ED25519"` in production.

**Alert conditions:**
- `activeKeyId` is `null` → no key is signing; new evidence submissions will fail.
- Any entry has `signingMode: "EPHEMERAL_DEV_ED25519"` in production → misconfiguration.

---

### `GET /api/key-registry/events`

Returns the full append-only lifecycle event log.

```sh
# All events
curl -s "https://<host>/api/key-registry/events" | jq .

# Events for a specific key
curl -s "https://<host>/api/key-registry/events?keyId=<key_id>" | jq .
```

**Use this endpoint for:**
- Compliance audits requiring a chain-of-custody record.
- Confirming that a `KEY_ACTIVATED` event exists for the currently active key.
- Verifying that `KEY_REVOKED` events include a reason and actor.

---

### Write endpoints (ADMIN only)

| Endpoint | Purpose |
|---|---|
| `POST /api/key-registry/:keyId/revoke` | Revoke a key with a mandatory reason. |
| `POST /api/key-registry/:keyId/retire` | Retire a non-active key (normal cleanup). |

These require the `Authorization: Bearer <ADMIN_API_KEY>` header. Rate-limited. No private key material is accepted or returned.

---

## 7. Security Constraints and Limitations

| Constraint | Detail |
|---|---|
| **No zero-downtime rotation** | Rotation requires a server restart. Plan a brief maintenance window. |
| **No HSM / TPM** | Private key material lives in process memory. The signing mode is `SOFTWARE_ED25519`. Do not represent the implementation as hardware-backed. |
| **No automated rotation scheduler** | Rotation is a manual deployment operation. Set a calendar reminder for annual rotation. |
| **Revocation is irreversible** | A revoked key can never be re-activated, even if the revocation was accidental. Generate a fresh key. |
| **Single-node private key** | The private key is not shared across instances — only the process holding `ED25519_SECRET_KEY_HEX` can sign. Multiple instances share the PostgreSQL registry for status reads. |
| **No private key in API** | No endpoint accepts, stores, or returns private key material. Rotation is always: update secret → restart. |

---

## 8. Quick Reference

### Planned annual rotation (summary)

```
1. node -e "..." → copy 64-char hex seed
2. Replit Secrets → update ED25519_SECRET_KEY_HEX
3. Restart workflow
4. Check logs for "Signing key registry ready" and PERSISTENT_ED25519
5. GET /api/key-registry → confirm new activeKeyId, old key RETIRED
```

### Emergency revocation (summary)

```
1. GET /api/key-registry → copy <key_id>
2. POST /api/key-registry/<key_id>/revoke  (ADMIN, with reason)
3. GET /api/key-registry → confirm revokedAt populated, activeKeyId null
4. Notify auditors with key_id, revokedAt, reason
5. Generate new key → update secret → restart (follow planned rotation)
```

### Log messages to recognise

| Log message | Meaning |
|---|---|
| `Ed25519 persistent signing identity loaded and verified.` | Secret key accepted, self-test passed. |
| `Signing key already ACTIVE in registry — idempotent restart.` | Same key restarted; no transition. |
| `Previous ACTIVE signing key retired during startup rotation.` | Old key retired atomically on startup. |
| `Signing key activated in registry.` | New key is now ACTIVE in DB. |
| `Signing key registry ready.` | HTTP server is about to begin accepting requests. |
| `Active signing key revoked.` | Emergency revocation completed; signing halted. |
| `[FATAL] ... is flagged as REVOKED` | Startup blocked — secret contains a revoked key. |
| `[FATAL] ED25519_SECRET_KEY_HEX is not configured` | Secret missing in production. |
| `[NON-PERSISTENT / NON-PRODUCTION] Ed25519 signing identity is EPHEMERAL.` | Dev mode — do not use in production. |

---

*For questions about this runbook, contact the TRUSTION platform team. For compliance inquiries, provide the output of `GET /api/key-registry/events` as the authoritative lifecycle audit trail.*
