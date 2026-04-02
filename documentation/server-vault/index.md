# Server Vault

## Problem

A web server running in production needs to read secrets (database credentials, API keys, encryption keys) at runtime. The secrets must be available when the process starts and on every request, but the server operator should not have to bake secrets into environment variables, config files, or container images.

Separately, an administrator needs to add, update, or remove secrets on the server without restarting the application.

## Current State

jseeqret already solves the **read** side. The `api.js` module provides:
- `init()` -- loads the vault database and symmetric key into memory at startup.
- `get_sync(key, app, env)` -- reads a secret from the in-memory cache. No disk I/O, no network call.
- `reload()` -- re-reads the vault from disk after an external update.

The **write** side is manual: the administrator copies secrets to the server via `scp` or `rsync`, or runs CLI commands over SSH.

## Two Use Cases

### UC1: Runtime Secret Access
The web server calls `init()` once at startup. Every subsequent `get_sync()` call returns from memory. This is fast (no I/O per request) and secure (secrets are never in environment variables or config files on disk outside the vault).

### UC2: Administrative Management
An administrator needs to:
- Add new secrets to the server vault.
- Update existing secrets (e.g., after a database password rotation).
- Remove obsolete secrets.
- Trigger a `reload()` so the running application picks up changes without a restart.

## Constraints

- The server may be a Windows or Linux machine.
- The administrator may not have direct shell access (e.g., managed hosting, containers).
- The vault directory must be writable by the admin process but readable by the web server process.
- Secrets must never leave the vault unencrypted (no plaintext in logs, env vars, or temp files).

## Relationship to Other Features

| Feature                              | Relationship                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [Vault-to-Vault](../vault-to-vault/) | The admin pushes secrets from their local vault to the server vault using NaCl transit encryption. |
| [Linked Vault](../linked-vault/)     | A server vault could be linked to a dev vault for automatic staging deployments.                   |
| [Auto-Rotation](../auto-rotation/)   | Rotated secrets on the server need to trigger `reload()` in the application.                       |
| [Shared Vault](../shared-vault/)     | Multiple administrators may need write access to the same server vault.                            |

## Existing Documents

- [Component Architecture](001-component-architecture.md) -- PlantUML diagram of the full jseeqret architecture.
- [Web Server Read Flow](002-sequence-webserver-read.md) -- Sequence diagram showing `init()` → `get_sync()` → `reload()`.
- [NaCl Transit Encryption](003-sequence-nacl-transit.md) -- Sequence diagram showing multi-user secret sharing models.

## Open Questions

1. **How does the admin push secrets remotely?** Options: CLI over SSH, HTTP API (vault service), or file-based sync via shared storage.
2. **How does `reload()` get triggered?** Options: file watcher on `seeqrets.db`, signal (SIGHUP on Linux), HTTP endpoint, or manual CLI command.
3. **Process isolation**: Should the web server process have read-only access to the vault, with a separate admin process handling writes?
4. **Container deployments**: How does the vault directory get mounted into a container? Volume mount, init container, or sidecar?

## Documents

- [Implementation Plan](plan.md) -- phased approach to server vault administration
