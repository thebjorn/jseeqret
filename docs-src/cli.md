---
title: CLI Reference
---

# CLI reference

Every command prints its full help with `-h`, e.g. `jseeqret export -h`.

## Global options

| Option              | Meaning                                                              |
|---------------------|----------------------------------------------------------------------|
| `-L, --log <level>` | Log level: `ERROR` (default), `WARNING`, `INFO`, `DEBUG`             |
| `--vault <name>`    | Use a named vault from the registry (see [Vaults](#vaults))          |
| `-V, --version`     | Print the version                                                    |

Environment variables:

| Variable                  | Meaning                                                        |
|---------------------------|----------------------------------------------------------------|
| `JSEEQRET`, `SEEQRET`     | Vault directory, or the name of a registered vault             |
| `JSEEQRET_TRACE=1`        | Stream Slack transport tracing to stderr                       |
| `JSEEQRET_SLACK_CLIENT_ID`| Override the Slack app client id used by `slack login`         |

## Filter specs

Commands that select secrets take a filter spec, `app:env:key`, where each
part is a glob. `KEY` means `*:*:KEY`, `APP:ENV` means `APP:ENV:*`, and an
empty part means `*` (`::DB_*`). Quote filters containing `*` so the shell
does not expand them.

## Vault setup

| Command                                      | What it does                                                              |
|----------------------------------------------|---------------------------------------------------------------------------|
| `init [dir] --email <email>`                 | Create a vault in `<dir>/seeqret` (`--user` defaults to `user@host`; `--pubkey`, `--key` reuse existing keys). Prints the `JSEEQRET` value to set. |
| `server init --email <e> --pubkey <key>`     | Create a vault for a headless server in `/srv/.seeqret`                    |
| `upgrade`                                    | Run pending database migrations                                           |
| `info [-d]`                                  | Show vault info (`-d`: as JSON)                                           |
| `gui [--dev]`                                | Launch the Electron GUI                                                   |

### Vaults

The vault is found in this order: `JSEEQRET`, then `SEEQRET` (each a path or a
registered vault name), then the registry default, then `/srv/.seeqret`
(not on Windows, where an unset vault is an error).

| Command                   | What it does                                  |
|---------------------------|-----------------------------------------------|
| `vault add <name> <path>` | Register a vault directory under a name       |
| `vault use <name>`        | Make it the default vault                     |
| `vault list`              | List registered vaults                        |
| `vault remove <name>`     | Unregister a vault (does not delete files)    |

The registry is `~/.seeqret/vaults.json`.

## Secrets

| Command                                         | What it does                                                         |
|-------------------------------------------------|----------------------------------------------------------------------|
| `add key <name> <value> [--app] [--env]`        | Add a secret. `--type int` stores an integer; `--force` overwrites.  |
| `add text <name> [--app] [--env]`               | Add a multi-line secret read from stdin until EOF                    |
| `list [-f <filter>]`                            | List secrets as a table                                              |
| `get <filter>`                                  | Print one secret's value; fails on zero or several matches           |
| `edit value <filter> <value> [--all]`           | Change the value of matching secrets (`--all`: no prompt)            |
| `rm key <filter>`                               | Remove matching secrets                                              |
| `env`                                           | Write `.env` from `env.template` (see [Getting Started](./getting-started.md)) |
| `importenv <file> [--app] [--env] [--update] [--dry-run]` | Import secrets from a `.env` file                          |
| `setenv <filter> [--dry-run]`                   | Windows only: set persistent user environment variables              |

## Users

| Command                                                     | What it does                                                       |
|-------------------------------------------------------------|--------------------------------------------------------------------|
| `introduction`                                              | Print a ready-to-paste `add user` command with your public key and fingerprint |
| `add user --username <u> --email <e> --pubkey <key> [--name]` | Add a user you can send secrets to                               |
| `rm user <username> [--yes]`                                | Remove a user (the owner cannot be removed)                        |
| `users [--export]`                                          | List users (`--export`: as `add user` commands)                    |
| `owner`, `whoami`, `public-key`                             | Show the vault owner, yourself, the owner's public key             |

Usernames are `user@host`; a bare `user` is accepted when it matches exactly
one user.

## Sharing secrets

| Command                                                                 | What it does                                                         |
|-------------------------------------------------------------------------|----------------------------------------------------------------------|
| `export --to <user...> [-f <filter...>] [-s <serializer>] [-o <file>]`  | Encrypt secrets for users. `--to self` is the owner, `--to all` every other user. `-w`/`-l` choose Windows/Linux line format. |
| `load [-u <sender>] (-f <file> \| -v <value>) [-s <serializer>] [--strategy]` | Import an export                                               |
| `send [filters...] --to <user> [--via file\|slack] [-o <file>]`         | Encrypt and send secrets to one user                                 |
| `receive [--via slack] [--watch] [--interval <s>] [--strategy]`         | Import secrets sent to you over Slack                                |
| `serializers`                                                           | List serializers (`json-crypt`, `command`, `env`, `backup`, `user-list`) |
| `backup [-o <file>] [--password <p>]`                                   | Back up the whole vault to a password-protected, self-decrypting HTML file |

When an import contains a secret you already have with a different value,
`load` lists the conflicts and stops, and `receive` fails closed. Pass
`--strategy mine` (keep yours), `theirs` (take theirs) or `newer` (keep the
most recently changed) to resolve them.

## Slack exchange

See [Slack Exchange](./slack-exchange.md) for the security model.

| Command                                  | What it does                                                      |
|------------------------------------------|-------------------------------------------------------------------|
| `slack login`                            | OAuth login and pick the exchange channel                         |
| `slack link <username> [--handle <h>]`   | Bind a user to a Slack handle after confirming their fingerprint  |
| `slack doctor [--accept] [--transport]`  | Health check; `--accept` records the MFA attestation and connected-apps baseline, `--transport` runs a live self-test |
| `slack status`                           | Show login, channel and last-seen state                           |
| `slack logout`                           | Remove all Slack configuration from the vault                     |

### Onboarding

Automated onboarding of a new team member over Slack:

| Who       | Command                                                        | What it does                                              |
|-----------|----------------------------------------------------------------|-----------------------------------------------------------|
| team lead | `onboard invite --email <e> --project <filter> [--name <n>]`   | Record the invite and post it                             |
| new user  | `onboard join`                                                 | Read the invite, verify the team lead's fingerprint, introduce yourself |
| team lead | `onboard watch [--once] [--interval <s>]`                      | Poll for introductions                                    |
| team lead | `onboard approve <email>`                                      | Approve an introduced user after verifying their fingerprint |
| new user  | `onboard receive`                                              | Import teammates and secrets once approved                |
| team lead | `onboard status`                                               | List onboardings in progress                              |

## ssh remotes

Push secrets to, and check them against, a secret store on another host.

| Command                                                   | What it does                                                    |
|-----------------------------------------------------------|-----------------------------------------------------------------|
| `remote add <alias> <user@host> --set <tpl> [--get <tpl>]` | Register a remote and the commands that set/get a secret there |
| `remote list`, `remote rm <alias>`                        | List or remove remotes                                          |
| `push <alias> [filterspec] [--dry-run]`                   | Run the `--set` command over ssh for each matching secret       |
| `verify <alias> [filterspec]`                             | Compare the `--get` output with the vault (prints no values)    |

In templates, `{key}` and `{value}` are substituted shell-quoted; don't add
quotes around them. Without `{value}` the value is piped on stdin, which
keeps it off the remote command line:

```bash
jseeqret remote add myhost me@myhost.example.com \
    --set "myvault set-secret --key {key} --stdin" \
    --get "myvault get-secret --key {key} --stdout"
jseeqret push myhost "myapp:prod:*" --dry-run
```
