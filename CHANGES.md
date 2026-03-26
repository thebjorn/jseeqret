# CHANGES — jseeqret vs seeqret API Differences

This document lists API differences between **jseeqret** (JavaScript, v0.5.7)
and **seeqret** (Python, v0.3.8) to help keep the two projects synchronized.

---

## Features in jseeqret but NOT in seeqret

### Multi-vault registry

jseeqret supports managing multiple vaults through a registry stored at
`~/.seeqret/vaults.json`.

- **CLI commands:**
  - `jseeqret vault list` — list registered vaults
  - `jseeqret vault add <name> <path>` — register a vault
  - `jseeqret vault remove <name>` — unregister a vault
  - `jseeqret vault use <name>` — set the default vault
  - `--vault <name>` — global option to select vault per invocation

- **Vault resolution order:**
  1. `JSEEQRET` env var (path or vault name)
  2. `SEEQRET` env var (path or vault name)
  3. Registry default (`_default` key in `vaults.json`)
  4. Linux fallback: `/srv/.seeqret`

- **Core module:** `src/core/vault-registry.js` — `registry_add()`,
  `registry_remove()`, `registry_use()`, `registry_list()`,
  `registry_resolve()`, `registry_default()`

### `JSEEQRET` environment variable

jseeqret checks `JSEEQRET` **before** `SEEQRET` for vault directory resolution.
seeqret only checks `SEEQRET`.

### `reload()` API function

```js
import { reload } from 'jseeqret'
await reload()  // re-reads database from disk
```

seeqret does not have an equivalent — the Python API only exposes `get()`.

### `get_sync()` API function

```js
import { init, get_sync } from 'jseeqret'
await init()           // one-time async setup
const val = get_sync('DB_PASSWORD')  // synchronous after init
```

seeqret's `get()` is already synchronous (SQLite3 is native in Python), so
there is no need for separate sync/async variants.

### `init()` and `close()` API functions

jseeqret requires explicit lifecycle management because sql.js needs async
WASM initialization:

```js
await init()    // load WASM + open database
// ... use get_sync() ...
close()         // release resources
```

seeqret opens the database on demand and relies on Python's GC.

### Electron GUI

jseeqret includes a full Electron + Svelte 5 desktop application with:
- Secret management (list, add, edit, delete)
- User management
- Multi-vault switching
- Import/export
- `jseeqret gui` CLI command to launch

seeqret has no GUI.

### `server init` command

```bash
jseeqret server init --email <email> --pubkey <pubkey>
```

Initializes a vault at `/srv/.seeqret` for headless servers without an
existing user identity. seeqret does not have this command.

### `add text` command

```bash
jseeqret add text <name> --app <app> --env <env>
```

Reads secret value from stdin (until EOF). Useful for multi-line secrets
like certificates or SSH keys.

seeqret does have `add text` as well — **verify this is synchronized**.

### `rm key` subcommand structure

jseeqret uses `jseeqret rm key <filter>` while seeqret may use a different
command structure for deletion. **Verify parity.**

---

## Features in seeqret but NOT in jseeqret

### GPG integration

seeqret has optional GPG support via `python-gnupg`. jseeqret does not
implement GPG-based operations.

### Windows `%APPDATA%\seeqret` fallback

On Windows with no `SEEQRET` env var, Python seeqret falls back to
`%APPDATA%\seeqret`. jseeqret throws an error on Windows if no env var
or registry default is set.

---

## API Differences (same feature, different behavior)

### Vault directory env var

| | seeqret (Python) | jseeqret (JavaScript) |
|---|---|---|
| Primary env var | `SEEQRET` | `JSEEQRET` (then `SEEQRET`) |
| Vault name lookup | No | Yes (via registry) |
| Windows fallback | `%APPDATA%\seeqret` | Error (no fallback) |

### Public API surface

| | seeqret (Python) | jseeqret (JavaScript) |
|---|---|---|
| `get()` | Synchronous | Async (returns Promise) |
| `get_sync()` | N/A | Synchronous (after `init()`) |
| `init()` | N/A | Required for sync API |
| `close()` | N/A | Releases WASM resources |
| `reload()` | N/A | Re-reads DB from disk |

### CLI framework

| | seeqret | jseeqret |
|---|---|---|
| Framework | Click | Commander.js |
| Global log option | Yes | `-L, --log <level>` |
| Global vault option | No | `--vault <name>` |

### `info` command output

| | seeqret | jseeqret |
|---|---|---|
| Default output | Hierarchical command tree | Version, vault dir, owner, counts |
| `--dump` flag | Dumps command tree as JSON | Dumps vault info as JSON |

### Database migrations

| | seeqret | jseeqret |
|---|---|---|
| Schema v1 | `db_v_001.py` | Part of `migrations.js` |
| Schema v2 | `db_v_002.py` | Part of `migrations.js` |
| Adds `type` column | v2 | v2 |
| Adds `updated` column | Unknown | v2 (`BOOL DEFAULT false`) |

### Symmetric key filename

Both projects support `seeqret.key`. seeqret also accepts the legacy name
`symetric.key` — jseeqret does not (verify if needed).

---

## Shared CLI Commands (feature parity)

Both projects implement these commands with equivalent behavior:

| Command | Status |
|---|---|
| `init [dir]` | Parity |
| `list [--filter]` | Parity |
| `get <filter>` | Parity |
| `add key <name> <value> [--app] [--env] [--type]` | Parity |
| `add user --username --email --pubkey` | Parity (minor option name differences) |
| `edit value <filter> <value> [--all]` | Parity |
| `users [--export]` | Parity |
| `owner` | Parity |
| `whoami` | Parity |
| `keys` | Parity |
| `upgrade` | Parity |
| `backup` | Parity |
| `export --to [--filter] [--serializer] [--out] [--windows\|--linux]` | Parity |
| `load --from-user [--file\|--value] [--serializer]` | Parity |
| `env` | Parity |
| `importenv <file> [--app] [--env] [--update] [--dry-run]` | Parity |
| `setenv <filter> [--dry-run]` | Parity (Windows only) |
| `serializers` | Parity |
| `introduction` | Parity |

---

## Shared Serializers

| Tag | seeqret | jseeqret |
|---|---|---|
| `env` | Yes | Yes |
| `json-crypt` | Yes | Yes |
| `command` | Yes | Yes |
| `backup` | N/A | Yes (jseeqret-only for `backup` command) |

---

## Database & Encryption Compatibility

These are shared and must remain identical:

- **SQLite database:** `seeqrets.db` with tables `migrations`, `users`, `secrets`
- **Symmetric encryption:** Fernet (AES-128-CBC + HMAC-SHA256)
- **Asymmetric encryption:** NaCl (X25519 + XSalsa20-Poly1305)
- **Key files:** `seeqret.key`, `public.key`, `private.key` (base64-encoded)
- **Filter spec format:** `app:env:key` with glob patterns (`*`, `?`)

---

## Action Items for Synchronization

1. **Multi-vault support** — Port vault registry to seeqret (Python), or
   decide this is jseeqret-only.
2. **`JSEEQRET` env var** — Should seeqret also check `JSEEQRET`?
3. **`info --dump`** — Align output format between the two projects.
4. **Windows fallback** — Add `%APPDATA%\seeqret` fallback to jseeqret,
   or remove from seeqret.
5. **`symetric.key` legacy name** — Should jseeqret also support it?
6. **`server init`** — Port to seeqret if useful.
7. **`add text`** — Verify both implementations handle stdin identically.
8. **`rm` command structure** — Verify identical subcommand syntax.
9. **`updated` column in schema v2** — Verify seeqret also has this.
