---
name: Ledger signing identity
description: The operational distinction between development-generated and production-persisted Ed25519 signing keys.
---

The ledger signing utility accepts `ED25519_SECRET_KEY_HEX` when a stable signing identity is required; without it, the API generates a process-local Ed25519 keypair for development.

**Why:** A generated fallback makes local testing easy, but every API restart changes the public key, so production verification needs a persistent secret.

**How to apply:** Configure `ED25519_SECRET_KEY_HEX` through the environment-secrets flow before publishing a production deployment. Never commit or print the secret.