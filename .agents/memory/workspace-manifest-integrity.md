---
name: Workspace manifest integrity
description: Root and package configuration files must remain single valid JSON documents for publishing and workspace installation.
---

Treat root workspace manifests as single-document configuration files. A pasted second JSON object can make `pnpm install` fail before any deployment build starts, even when individual app builds work locally.

**Why:** Publishing installs dependencies from the committed repository before running artifact-specific build commands.

**How to apply:** When publishing fails during package installation, parse the root `package.json` and relevant `tsconfig.json` files first, then run `pnpm install --frozen-lockfile` before investigating app runtime behavior.