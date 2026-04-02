# Linked Vault -- Implementation Plan

## Overview

Linked vault lets a single user keep two or more vaults in sync. It builds on multi-vault (vault registry) and vault-to-vault (NaCl transport), adding link metadata, a sync command, and the sync-merge algorithm.

**Assumption**: Both vaults are on Windows machines. One machine (home) may be behind a VPN and unreachable from the other (work), but both can access a shared intermediary such as a cloud sync folder (OneDrive, Dropbox, Google Drive) or a network share.

## Prerequisites

- **Multi-Vault registry** (`vaults.json`, `--vault` CLI option) -- must land first so the CLI can address vaults by name.
- **Sync-Merge algorithm** ([see sync-merge plan](../sync-merge/plan.md)) -- the conflict resolution logic is shared infrastructure, not linked-vault-specific.

## Phase 1: Link Metadata

### Goal
Store which vaults are linked and how to reach them.

### Design

A `links` table in `seeqrets.db`:

```sql
CREATE TABLE IF NOT EXISTS links (
    id          TEXT PRIMARY KEY,       -- UUID
    name        TEXT NOT NULL,          -- human-readable name for the remote vault
    vault_id    TEXT NOT NULL,          -- identity of the remote vault
    transport   TEXT NOT NULL,          -- 'file', 'http'
    address     TEXT NOT NULL,          -- transport-specific (file path, UNC path, URL)
    direction   TEXT DEFAULT 'both',    -- 'push', 'pull', 'both'
    filter      TEXT DEFAULT '*:*:*',   -- FilterSpec glob for selective sync
    last_sync   TEXT,                   -- ISO 8601 timestamp of last successful sync
    created_at  TEXT NOT NULL,          -- ISO 8601
    updated_at  TEXT NOT NULL           -- ISO 8601
);
```

### CLI Commands

```powershell
jseeqret link add home --transport file --address "C:\Users\bp\OneDrive\.seeqret-sync"
jseeqret link add work --transport file --address "\\server\share\.seeqret-sync"
jseeqret link list
jseeqret link remove home
jseeqret link show home
```

### Deliverables
- Migration adding `links` table
- `src/core/link.js` module -- CRUD operations on link records
- CLI commands in `src/cli/commands/link.js`
- Tests for link CRUD

## Phase 2: Vault Identity

### Goal
Each vault needs a stable identity so linked vaults can recognize each other across syncs.

### Design

A `vault_meta` table (or a row in a `config` table):

```sql
CREATE TABLE IF NOT EXISTS vault_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- Populated on vault init:
-- ('vault_id', '<uuid>')
-- ('vault_name', '<user-chosen name>')
-- ('created_at', '<iso8601>')
```

The `vault_id` is generated once during `jseeqret init` and never changes. It identifies the vault across transports and renames.

### Deliverables
- Migration adding `vault_meta` table
- `vault_id` generation in `init` command
- Backfill: existing vaults get a `vault_id` on first access after migration

## Phase 3: Sync Command

### Goal
A single command that syncs the local vault with a linked remote vault.

### Workflow

```powershell
jseeqret sync home              # sync with a specific link
jseeqret sync --all             # sync with all links
jseeqret sync home --dry-run    # preview changes without applying
```

#### Sync Steps

1. **Connect** to remote vault via the configured transport.
2. **Exchange manifests** -- each side sends a list of `(app, env, key, updated_at, deleted_at)` tuples. No secret values cross the wire in this step.
3. **Compute diff** using the [sync-merge algorithm](../sync-merge/plan.md).
4. **Transfer secrets** -- only the secrets that need to move are encrypted (NaCl or shared key) and transmitted.
5. **Apply changes** -- each side applies inserts, updates, and deletes.
6. **Update `last_sync`** on the link record.

### Transports

On Windows workstations, SSH is not a practical default (OpenSSH server is rarely configured). The two transports that fit the Windows ecosystem are file-based sync and HTTP.

#### File Transport (primary)

The file transport uses a **shared intermediary directory** -- a folder that both machines can access, either directly or through cloud sync. This is the "mailbox" pattern: each vault writes its outbound sync bundle to the shared folder, and reads the other vault's bundle from the same folder.

**Supported shared folder types:**

| Type                | Example Path                         | Notes                                                                        |
| ------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| Cloud sync folder   | `C:\Users\bp\OneDrive\.seeqret-sync` | Most practical for the home/work scenario. Both machines sync via the cloud. |
| Network share (UNC) | `\\fileserver\team\.seeqret-sync`    | Works when both machines are on the same network.                            |
| Mapped drive        | `Z:\.seeqret-sync`                   | Same as UNC but with a drive letter.                                         |
| USB drive           | `E:\.seeqret-sync`                   | Sneakernet -- sync by physically moving the drive.                           |

**Sync bundle structure:**

The shared directory contains one subdirectory per vault (named by `vault_id`):

```
.seeqret-sync/
  <vault-id-home>/
    manifest.json       # current manifest (metadata only, no secrets)
    outbox.json         # encrypted secrets to push to other vaults
    last_sync.json      # timestamp of last sync
  <vault-id-work>/
    manifest.json
    outbox.json
    last_sync.json
  sync.lock             # lockfile to prevent concurrent writes
```

**How a sync works (cloud sync folder scenario):**

1. User runs `jseeqret sync home` on the **work** machine.
2. jseeqret writes work's `manifest.json` and `outbox.json` (encrypted secrets that are newer locally) to `<vault-id-work>/`.
3. jseeqret reads home's `manifest.json` and `outbox.json` from `<vault-id-home>/`.
4. If home's files are present, jseeqret computes the diff and applies incoming changes to the local vault.
5. OneDrive syncs the work machine's outbox to the cloud.
6. Later, on the **home** machine, the user runs `jseeqret sync work`. The reverse happens: home reads work's outbox (synced down by OneDrive), applies changes, and writes its own updated manifest/outbox.

**This is asynchronous by design** -- the two machines don't need to be online simultaneously. The cloud folder acts as a message queue.

**Lockfile handling:**

- The `sync.lock` file prevents two sync operations from writing to the shared directory at the same time (relevant for network shares where both machines might sync concurrently).
- Lock is acquired with a timeout (default 30 seconds). If the lock is stale (older than 5 minutes), it is forcibly removed.
- For cloud sync folders, concurrent access is unlikely since only one machine syncs at a time. The lockfile is still used as a safety measure.
- Uses `fs.mkdirSync()` for atomic lock acquisition (creating a directory is atomic on both NTFS and most network filesystems).

**Outbox encryption:**

Secrets in `outbox.json` are encrypted with the destination vault's public key (NaCl). If both vaults belong to the same user, a simpler approach is possible: encrypt with a shared sync key derived from both vaults' symmetric keys. For v1, use NaCl since it already works.

**Cloud sync latency:**

OneDrive / Dropbox / Google Drive sync is not instant. There is typically a 1-30 second delay for small files. The sync command does not wait for cloud propagation -- it writes locally and trusts the cloud sync client to deliver. The user may need to wait for cloud sync to complete before syncing on the other machine. The `--wait` flag could poll for the remote vault's manifest to update, but this is a v2 enhancement.

#### HTTP Transport (future)

- Requires a vault service (Plan B from the roadmap).
- `POST /sync` endpoint exchanges manifests and secrets.
- Deferred until the vault service exists.
- Most relevant when the work machine can expose a service endpoint (less likely behind corporate firewalls).

### Deliverables
- `src/core/sync.js` -- orchestrates the sync workflow
- `src/core/transports/file.js` -- file transport implementation
- `src/cli/commands/sync.js` -- CLI sync command
- Tests for file transport (mocked filesystem) and end-to-end sync

## Phase 4: Selective Sync and Filters

### Goal
Allow users to sync only a subset of secrets.

### Design

The `filter` column on the `links` table holds a `FilterSpec` glob pattern. During manifest exchange, only secrets matching the filter are included.

```powershell
jseeqret link add staging --transport file `
    --address "C:\Users\bp\OneDrive\.seeqret-sync" `
    --filter "myapp:staging:*"
```

### Deliverables
- Integration of `FilterSpec` into the sync manifest step
- CLI `--filter` option on `link add` and `sync`
- Tests for filtered sync

## Phase 5: GUI Integration

### Goal
Sync operations available in the Electron GUI.

### Design
- Link management panel (add, remove, list links)
- Sync button per link with progress indicator
- Sync log viewer showing what changed
- Notification when a linked vault has unsynced changes (detected on app start)
- Folder picker dialog for choosing the shared sync directory (uses Electron's `dialog.showOpenDialog`)

### Deliverables
- IPC handlers for link CRUD and sync
- Svelte components for link management
- Sync progress and result display

## Security Considerations

1. **Transit encryption**: Secrets in `outbox.json` are NaCl-encrypted even though the cloud sync folder may have its own encryption. Defense in depth -- if the cloud account is compromised, the secrets are still protected.
2. **No shared vault keys**: Linked vaults do not share `seeqret.key`. Each vault encrypts at rest with its own key. Secrets are decrypted during sync and re-encrypted with the destination vault's key.
3. **Manifest privacy**: The manifest contains metadata (app, env, key names, timestamps) but no secret values. For cloud sync folders, the manifest reveals *which* secrets exist (by name) to anyone with access to the cloud account. If this is a concern, the manifest can be encrypted with the sync key. For v1, this is acceptable since the cloud account is the user's own.
4. **Sync directory permissions**: On NTFS, the `.seeqret-sync` folder should have restricted ACLs (owner-only access). The `link add` command should warn if the directory has overly permissive ACLs.
5. **Cloud provider trust**: The user trusts their cloud sync provider (Microsoft, Dropbox, Google) with encrypted blobs. The NaCl encryption ensures the provider cannot read secret values, but they can observe sync patterns (file sizes, frequency). This is an acceptable trade-off for the convenience of cloud-based sync.

## Path Handling

All file paths in jseeqret use `path.resolve()` and `path.join()` from Node.js, which handle Windows backslashes correctly. The `address` field in the `links` table stores the path as the user provided it. Paths are normalized at runtime.

UNC paths (`\\server\share\...`) are supported natively by Node.js `fs` operations on Windows. No special handling is needed beyond ensuring the path is quoted in CLI arguments.

## Relationship to Roadmap

This feature spans multiple roadmap phases:
- **Phase 1** (Foundation): Multi-vault registry and vault identity are prerequisites.
- **Phase 2** (Sharing): Link metadata and file sync are natural extensions of the vault-to-vault export/import work.
- **Phase 3** (Service): HTTP transport becomes available when the vault service exists.

## Open Questions

1. **Should sync be automatic?** A file watcher (using `fs.watch` or `chokidar`) on the sync directory could trigger sync when the cloud client delivers new files. This is appealing on Windows since file watchers work well on NTFS. Recommendation: start with manual `jseeqret sync`, add watcher mode later.
2. **Conflict notification**: When a last-write-wins resolution overwrites a local change, should the user be notified? Probably yes -- a sync log or `--dry-run` mode.
3. **Large vaults**: For vaults with thousands of secrets, manifest exchange should be efficient. Consider sending only changes since `last_sync` rather than the full manifest.
4. **Tombstones vs. hard deletes**: To propagate deletions, we need to keep a record of deleted secrets (tombstones) at least until the next sync. See [sync-merge plan](../sync-merge/plan.md) for details.
5. **Cloud sync detection**: Should jseeqret detect whether the sync directory is inside a known cloud sync folder (OneDrive, Dropbox) and adjust behavior accordingly? For example, showing "waiting for cloud sync" in the GUI.
6. **Windows Task Scheduler**: For users who want periodic automatic sync, a scheduled task is the Windows equivalent of a cron job. Should `jseeqret link add` offer to create one? Probably too invasive for v1.
