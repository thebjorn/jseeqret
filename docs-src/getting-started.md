---
title: Getting Started
---

# Getting Started

This guide walks through installing jseeqret, initializing your first
vault, and storing and retrieving a secret from both the CLI and the
Node.js API.

## Install

```bash
npm install -g jseeqret
```

The `jseeqret` command is now on your PATH. If you prefer not to
install globally, use `npx jseeqret ...` or add it as a dev dependency
of a single project.

## Create a vault

Every user has one or more *vaults* — directories that hold the
encrypted SQLite database (`seeqrets.db`), a symmetric Fernet key
(`seeqret.key`), and an asymmetric NaCl keypair (`public.key` /
`private.key`). Create one with:

```bash
jseeqret init ./my-vault --email alice@example.com
```

This creates the vault in `./my-vault/seeqret`. Your username defaults
to `<os-user>@<host>`; keep that default, because `whoami` and
`introduction` recognise you by it.

jseeqret finds the vault through the `JSEEQRET` env var, then
`SEEQRET` (either can be a path or the name of a vault registered with
`jseeqret vault add`), then the registry default (`jseeqret vault use`),
then `/srv/.seeqret` (except on Windows, where it is an error). For the
rest of this guide, point the env var at your fresh vault:

```bash
export JSEEQRET="$(pwd)/my-vault/seeqret"
```

## Add and read a secret

```bash
jseeqret add key DATABASE_URL 'postgres://localhost/app' \
    --app myapp --env prod

jseeqret list -f 'myapp:prod:*'
jseeqret get myapp:prod:DATABASE_URL
```

Secrets are scoped by an `app:env:key` triple. Both `app` and `env`
default to `*` if omitted, which is fine for single-project vaults
but useful once you start sharing the same vault across projects.

## Materialize a `.env`

When your app just needs a local `.env` file at deploy time, write an
`env.template` that lists the filter specs you need:

```
@seeqret>=1.0
myapp:prod:*
DB_URL=myapp:prod:DATABASE_URL
```

Then run `jseeqret env` in the same directory to produce `.env`.

- A line with a filter spec writes every matching secret.
- `NAME=filter` writes the matching secret under a different name. An
  unquoted right side containing a colon is a filter.
- `NAME=value` (no colon) and `NAME="value"` (always) write a constant,
  without looking anything up.
- `@seeqret>=1.0` fails the run if the installed jseeqret is older than
  that version.

See the [CLI reference](./cli.md) for every command.

## Using the library

The same core used by the CLI is exposed as an npm package:

```js
import { init, get } from 'jseeqret/core'

await init()    // opens the vault from JSEEQRET / SEEQRET or the registry default
const db_url = await get('myapp:prod:DATABASE_URL')
```

`get()` must match exactly one secret. It throws `SecretNotFound` when
nothing matches and `AmbiguousSecret` when several secrets do (e.g.
`get('::DATABASE_URL')` with the key in both prod and dev); both
messages say what was looked up and never contain secret values.

See the {@link core | core module} for the full API surface.
