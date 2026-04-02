# Multi-Vault

## Problem

In the current design, there is a single vault directory (default: `/srv/.seeqret` or `%JSEEQRET%`) containing one `seeqret.key` and one `seeqrets.db`. A user who needs separate vaults for different purposes -- personal vs. work, project A vs. project B, dev vs. staging -- must manually juggle environment variables to switch between vault directories.

## Desired Behavior

1. **Named vaults** -- each vault has a human-readable name (e.g., `personal`, `work`, `staging-myapp`).
2. **Vault registry** -- a central registry maps vault names to their directory paths.
3. **CLI vault switching** -- a `--vault <name>` option on all CLI commands selects which vault to operate on.
4. **Default vault** -- one vault is marked as the default, used when `--vault` is not specified.
5. **GUI vault picker** -- the Electron app shows a vault selector, allowing the user to switch between vaults without restarting.

## Constraints

- The registry itself must not contain secrets -- it is a plain JSON file mapping names to paths.
- Each vault is fully independent: its own `seeqret.key`, `seeqrets.db`, and keypair files.
- The registry location should follow platform conventions: `%APPDATA%\jseeqret\` on Windows, `~/.config/jseeqret/` on Linux (XDG), `~/Library/Application Support/jseeqret/` on macOS.
- Must not break existing single-vault usage. If no registry exists, jseeqret behaves exactly as it does today.

## Relationship to Other Features

| Feature                                | Relationship                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Linked Vault](../linked-vault/)       | Prerequisite -- vaults must be addressable by name before they can be linked.                                            |
| [Shared Vault](../shared-vault/)       | A shared vault appears in the registry like any other vault, but multiple users' registries point to the same directory. |
| [Server Vault](../server-vault/)       | A server vault is a named entry in the admin's registry, accessed via `--vault server-prod`.                             |
| [Vault Hierarchy](../vault-hierarchy/) | The registry is the starting point for organizing vaults into a trust tree.                                              |

## Use Cases

### UC1: Personal and work separation
A developer has `personal` vault with their own API keys and a `work` vault shared with the team. `jseeqret get DB_PASSWORD --vault work` vs. `jseeqret get GITHUB_TOKEN --vault personal`.

### UC2: Per-project vaults
A consultant working on multiple client projects keeps each client's secrets isolated: `--vault client-acme`, `--vault client-globex`.

### UC3: Dev/staging/prod environments
Different vaults for different deployment targets. `jseeqret export --vault dev --filter 'myapp:staging:*'` exports secrets for staging deployment.

## Open Questions

1. **Registry format**: Flat JSON (`{"personal": "C:\\Users\\bp\\.seeqret", "work": "Z:\\.seeqret"}`) or more structured (with metadata like `created_at`, `last_used`)?
2. **Vault creation**: Should `jseeqret init --name work --path C:\vaults\work` create the vault and register it in one step?
3. **Environment variable override**: Should `JSEEQRET` / `SEEQRET` env vars override the registry, or should they be ignored when `--vault` is specified?
4. **API impact**: Should `api.init()` accept a vault name? Or should the API only work with paths, leaving name resolution to the CLI/GUI layer?

## Documents

- [Implementation Plan](plan.md) -- registry design, CLI changes, and phased rollout
