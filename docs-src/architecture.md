---
title: Architecture
---

# Architecture

jseeqret is a three-layer project sharing one core:

```
+--------------------+   +----------------+   +----------------------+
|  CLI (Commander)   |   |  Electron UI   |   |  Node.js library     |
|  src/cli/**        |   |  src/main/**   |   |  (consumers of core) |
|                    |   |  src/renderer  |   |                      |
+---------+----------+   +--------+-------+   +-----------+----------+
          |                       |                       |
          +-----------+-----------+-----------+-----------+
                      |                       |
                      v                       v
               +---------------------------------+
               |  core  (src/core/**)            |
               |  - models: Secret, User         |
               |  - crypto: Fernet + NaCl        |
               |  - storage: sql.js SQLite        |
               |  - filter: app:env:key matcher  |
               |  - serializers: import/export   |
               +---------------------------------+
```

All three frontends share the same core, which is what the published
npm package exports. Anything that can be done from the CLI can be
done from a Node.js script via the library.

## Vault directory

A vault is a directory with four artifacts:

| file            | purpose                                         |
|-----------------|-------------------------------------------------|
| `seeqrets.db`   | SQLite database (sql.js/WASM, no native deps)   |
| `seeqret.key`   | base64 Fernet key — encrypts secret values      |
| `public.key`    | base64 NaCl public key for the vault owner      |
| `private.key`   | base64 NaCl private key — **do not share**      |

The database schema is managed by migrations in
`src/core/migrations.js` and mirrors the Python `seeqret` layout, so a
vault created by either tool can be opened by the other.

## Crypto stack

Two algorithms, two jobs:

- **Fernet** (`core/crypto/fernet`) — symmetric AES-128-CBC with
  HMAC-SHA256. Every secret value stored in `seeqrets.db` is
  Fernet-encrypted with the vault's `seeqret.key`. Guards against the
  DB file being copied without the key.

- **NaCl** (`core/crypto/nacl`) — asymmetric X25519 + XSalsa20-Poly1305
  via tweetnacl. Used for peer-to-peer exchange: `export`, `send`,
  `receive`. Each user owns a NaCl keypair, and blobs are sealed for a
  specific recipient's public key.

See [Slack Exchange](slack-exchange.md) for how the transport layer
uses NaCl to ship encrypted blobs through an untrusted intermediary.

## Storage

`SqliteStorage` (`core/sqlite-storage.js`) wraps sql.js — a pure-JS
WebAssembly build of SQLite. This is a deliberate choice:

- No native bindings means the same code runs in Electron's renderer
  and in a Lambda runtime without rebuilding.
- The entire database file is a single artifact; copying it is a
  complete backup (still useless without `seeqret.key`).

`fetch_secrets({ app, env, key })` is the main read path; the
`FilterSpec` class turns a user-typed `myapp:*:DB_*` string into that
object via glob-to-SQL translation.
