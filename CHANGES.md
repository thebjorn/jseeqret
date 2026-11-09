# CHANGES — jseeqret vs seeqret differences

This document lists the differences between **jseeqret** (JavaScript, 3.0)
and **seeqret** (Python, 2.0) to help keep the two projects synchronized.
Both read and write the same vault, so the database schema, key files and
encryption formats must stay identical (see the end of this file).

---

## Library API

| | seeqret (Python) | jseeqret (JavaScript) |
|---|---|---|
| `get()` | Synchronous | Async (returns Promise) |
| `get()` naming | `'app:env:key'` or `key, app=, env=` | `'app:env:key'` or `key, app, env` |
| `get()` wildcards | `*`/globs match; exactly one match required | same |
| `get()` no match | `SecretNotFound` (a `KeyError`) | `SecretNotFound` (an `Error`) |
| `get()` several matches | `AmbiguousSecret` (a `LookupError`) | `AmbiguousSecret` (an `Error`) |
| `get_sync()` | N/A (`get()` is already synchronous) | Synchronous, after `init()` |
| `init()` / `close()` | N/A (opens the database on demand) | Load sql.js WASM and the vault / release it |
| `reload()` | N/A | Re-read the database from disk |
| `parse_reference()` | `seeqret.storage.get_secret.parse_reference` | exported from `jseeqret` |

## Vault location

| | seeqret (Python) | jseeqret (JavaScript) |
|---|---|---|
| Environment variable | `SEEQRET` | `JSEEQRET`, then `SEEQRET` |
| Value can be a registry name | No | Yes |
| Registry default (`~/.seeqret/vaults.json`) | No | Yes (`vault use`) |
| Fallback | `/srv/.seeqret` on Linux/macOS; Windows requires `SEEQRET` | `/srv/.seeqret` on Linux/macOS; Windows requires an env var or registry default |

---

## CLI

### Shared commands

Same command names, arguments and behavior unless noted.

| Command | Notes |
|---|---|
| `init [dir]`, `server init` | |
| `get <filter>` | Fails on zero or several matches |
| `add key <name> <value> [--app] [--env] [--force]` | jseeqret also has `--type` |
| `add text <name>` | jseeqret reads piped stdin to EOF; seeqret reads interactively until Ctrl-D, so it cannot be piped |
| `add user --username --email --pubkey [--name]` | seeqret prompts for missing options; jseeqret requires them |
| `edit value <filter> <value> [--all]` | |
| `rm key <filter>`, `rm user <username> [--yes]` | |
| `users [--export]`, `owner`, `whoami`, `public-key`, `introduction` | |
| `upgrade`, `serializers` | |
| `backup` | Password-protected, self-decrypting HTML in both |
| `export --to <user\|self\|all> [-f] [-s] [-o] [-w\|-l]` | |
| `load [-u] [-f\|-v] [-s]` | jseeqret also has `--strategy` |
| `send [filters] --to <user> [--via file\|slack]` | |
| `receive [--via slack] [--watch] [--interval]` | jseeqret also has `--strategy` |
| `slack login\|logout\|status\|link\|doctor` | jseeqret's `doctor` also has `--transport` |
| `env`, `importenv <file>`, `setenv <filter>` (Windows) | |
| `remote add\|list\|rm` | |
| `push <alias> [filter]`, `verify <alias> [filter]` | ssh remotes; seeqret also accepts several comma-separated aliases |
| `-L, --log <level>` | |

### Different behavior

| | seeqret | jseeqret |
|---|---|---|
| `list` filter | positional `FILTERSPEC` (or `-f`), plus `--env` for .env output | `-f` only |
| `info` | Hierarchical command tree (`--dump`: as JSON) | Version, vault dir, owner, counts (`--dump`: as JSON) |
| Conflicting import (`load`, `receive`) | Overwrites existing values | Lists conflicts and stops; `--strategy mine\|theirs\|newer` resolves them |

### Only in jseeqret

- **Electron GUI** (`jseeqret gui`): secrets, users, vault switching,
  import/export, onboarding.
- **Vault registry**: `vault add|use|list|remove`, the global
  `--vault <name>` option.
- **Onboarding over Slack**: `onboard invite|join|watch|approve|receive|status`.
- `--strategy` on `load` and `receive`; `slack doctor --transport`.
- `user-list` serializer (encrypted list of user records, used by onboarding).

### Only in seeqret

- `pull <alias> KEY...`: fetch secrets from an ssh remote into the vault.
- `push vercel`, `verify vercel`: Vercel project environment variables.
- `list --env` and the positional `list` filter.

---

## Shared serializers

| Tag | seeqret | jseeqret |
|---|---|---|
| `json-crypt` | Yes | Yes |
| `command` | Yes | Yes |
| `env` | Yes | Yes |
| `backup` (plaintext JSON, insecure) | Yes | Yes |
| `user-list` | No | Yes |

---

## Database & encryption compatibility

These are shared and must remain identical:

- **SQLite database:** `seeqrets.db`. Any new migration in one project
  needs a matching migration in the other:

  | Version | Change |
  |---|---|
  | v1 | `migrations`, `users`, `secrets` |
  | v2 | `secrets.type`, `secrets.updated` |
  | v3 | Slack columns on `users`, `kv` table |
  | v4 | `onboarding` table |
  | v5 | `users.name` |
  | v6 | `secrets.updated_at` |
  | v7 | `remotes` table |

- **Symmetric encryption:** Fernet (AES-128-CBC + HMAC-SHA256), key in
  `seeqret.key`
- **Asymmetric encryption:** NaCl (X25519 + XSalsa20-Poly1305), keys in
  `public.key` / `private.key` (base64)
- **Filter spec format:** `app:env:key` with glob patterns (`*`, `?`)

---

## Open synchronization questions

1. **Vault registry** — port to seeqret, or keep it jseeqret-only?
2. **`JSEEQRET` env var** — should seeqret also check it?
3. **`info`** — align the output of the two projects?
4. **Conflicting imports** — seeqret silently overwrites; should it adopt
   jseeqret's `--strategy`?
5. **`add text`** — make seeqret read piped stdin like jseeqret?
6. **`list`** — add the positional filter and `--env` to jseeqret?
7. **`pull`, Vercel targets, multi-alias `push`/`verify`** — port to jseeqret?
