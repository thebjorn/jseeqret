# Linked Vault

## Problem

As a developer working from home, I add secrets to my home vault while building new features. When I go to the office the next day, my work vault is missing the secrets the new code depends on -- the app fails to start or behaves unexpectedly.

The core tension: it is **too early to export** during active development. The set of secrets is volatile -- names change, values get tweaked, some get deleted entirely. Exporting a half-baked set of secrets to every team member is wasteful and noisy. But **forgetting to sync** when the dust settles means broken environments.

## Constraints

- Both vaults are on Windows machines.
- One vault (home) is behind a VPN and unreachable from work -- no inbound connections possible.
- Both machines can access a shared intermediary (cloud sync folder like OneDrive, network share, or USB drive).
- SSH is not practical -- OpenSSH server is rarely configured on Windows workstations.
- The user may not have a service running on either machine -- sync must work from the initiating side.
- Must work with the existing vault structure (`seeqrets.db`, `seeqret.key`, key files).

## Desired Behavior

1. **Link two vaults** so they are aware of each other's existence and share an identity relationship.
2. **Sync on demand** -- the user runs a command (or the GUI triggers it) to push/pull changes between linked vaults.
3. **Automatic conflict resolution** -- when the same secret exists in both vaults with different values, the most recently modified value wins (last-write-wins).
4. **Selective sync** -- optionally restrict which secrets sync (by app, environment, or glob pattern via `FilterSpec`).
5. **Deletion propagation** -- a secret deleted in one vault should be deleted in the linked vault if the deletion is more recent than the last modification.
6. **Offline-first** -- linking metadata is stored locally. Sync happens when connectivity is available, not continuously.

## Relationship to Other Features

| Feature | Relationship |
|---------|-------------|
| [Multi-Vault](../multi-vault/) | Prerequisite -- the user must be able to manage multiple vaults before linking them. |
| [Vault-to-Vault](../vault-to-vault/) | Linked vault builds on the existing NaCl transit encryption for secure transport. |
| [Sync-Merge](../sync-merge/) | The merge algorithm that resolves conflicts during sync. Linked vault is the *feature*; sync-merge is the *mechanism*. |
| [Auto-Rotation](../auto-rotation/) | Rotated secrets should propagate through linked vaults. A rotation in one vault should update all linked vaults. |
| [Shared Vault](../shared-vault/) | Complementary but different. Shared vault = multiple users, one vault. Linked vault = one user, multiple vaults. |

## Use Cases

### UC1: Developer with home and work machines
Developer adds `STRIPE_SECRET_KEY` to home vault while building a payment feature. Next morning at work, runs `jseeqret sync` and the secret appears in the work vault.

### UC2: Laptop and desktop
Same user has a laptop for travel and a desktop at home. Secrets stay in sync without manual export/import cycles.

### UC3: Staging environment prep
Developer links their dev vault to a staging server vault. New secrets added during development automatically become available in staging (filtered by `env:staging:*`).

## Open Questions

1. **Transport mechanism**: File-based via cloud sync folder (OneDrive, Dropbox), network share, or USB drive. HTTP POST to a vault service is a future option.
2. **Identity**: Should linked vaults share the same keypair, or should they be separate identities that trust each other?
3. **Sync direction**: Always bidirectional, or allow one-way links (push-only, pull-only)?
4. **Link metadata storage**: In the vault database (new table), or in a separate config file (`links.json`)?
5. **Encryption in transit**: Reuse existing NaCl transit encryption, or use a shared symmetric key since both vaults belong to the same user?

## Documents

- [Implementation Plan](plan.md) -- phased approach to building linked vault support
