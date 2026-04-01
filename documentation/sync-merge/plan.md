# Sync-Merge -- Implementation Plan

## Overview

The sync-merge module is the conflict resolution engine for vault synchronization. It takes two manifests (local and remote), computes a diff, and produces a set of operations to apply on each side. It is a pure-logic module with no transport or storage dependencies.

## Phase 1: Schema Changes for Tombstones

### Goal
Support soft deletes so deletions can propagate through sync.

### Migration

```sql
ALTER TABLE secrets ADD COLUMN deleted_at TEXT DEFAULT NULL;
```

Secrets with a non-null `deleted_at` are tombstones. They are excluded from normal queries (`get`, `list`) but included in sync manifests.

### Storage Changes

- `SqliteStorage.delete_secret()` sets `deleted_at = now()` instead of `DELETE FROM`.
- New method: `SqliteStorage.hard_delete(app, env, key)` for garbage collection.
- New method: `SqliteStorage.fetch_manifest()` returns all secrets (including tombstones) with only metadata columns -- no decryption needed.
- `SqliteStorage.fetch_secrets()` gains a `WHERE deleted_at IS NULL` clause (backward-compatible -- existing queries already return only live secrets).

### Deliverables
- Migration v00N adding `deleted_at` column
- Updated `SqliteStorage` methods
- Updated `Secret` model with `deleted_at` field
- Tests for soft delete behavior

## Phase 2: Manifest and Content Hash

### Goal
Generate a compact representation of vault contents for diffing.

### Manifest Entry

```javascript
class ManifestEntry {
    constructor({ app, env, key, updated_at, deleted_at, content_hash }) {
        this.app = app
        this.env = env
        this.key = key
        this.updated_at = updated_at    // ISO 8601 UTC
        this.deleted_at = deleted_at    // ISO 8601 UTC or null
        this.content_hash = content_hash // SHA-256 of the encrypted value
    }
}
```

### Content Hash

The hash is computed over the Fernet-encrypted value (the token stored in the database). This means:
- Two vaults with the same plaintext value but different `seeqret.key` files will have different content hashes (different Fernet tokens).
- This is intentional -- we cannot compare plaintext without decrypting, and decrypting on both sides just for comparison is expensive and a security risk.
- However, for same-user linked vaults with different keys, this means the "same value, no action" optimization won't trigger. The timestamp comparison still produces the correct result (the newer value wins, which is the same value -- a harmless no-op update).

If linked vaults share the same `seeqret.key`, content hashes match for identical values and the optimization works.

### Deliverables
- `src/core/manifest.js` -- `ManifestEntry` class, `build_manifest(storage)` function
- Content hash computation in `SqliteStorage.fetch_manifest()`
- Tests for manifest generation

## Phase 3: Diff Algorithm

### Goal
Compare two manifests and produce a list of sync operations.

### Algorithm

```
function compute_diff(local_manifest, remote_manifest):
    ops = []
    local_map  = index by (app, env, key)
    remote_map = index by (app, env, key)

    for each key in union(local_map.keys, remote_map.keys):
        local  = local_map[key]   // may be undefined
        remote = remote_map[key]  // may be undefined

        if local and not remote:
            if local.deleted_at:
                ops.push(NOOP)  // deleted locally, never existed remotely
            else:
                ops.push(INSERT_REMOTE, key)  // copy local → remote
        
        else if remote and not local:
            if remote.deleted_at:
                ops.push(NOOP)  // deleted remotely, never existed locally
            else:
                ops.push(INSERT_LOCAL, key)  // copy remote → local
        
        else:  // both exist
            if local.deleted_at and remote.deleted_at:
                ops.push(NOOP)  // both deleted

            else if local.deleted_at and not remote.deleted_at:
                if local.deleted_at > remote.updated_at:
                    ops.push(DELETE_REMOTE, key)  // deletion wins
                else:
                    ops.push(RESURRECT_LOCAL, key)  // remote modification wins
            
            else if remote.deleted_at and not local.deleted_at:
                if remote.deleted_at > local.updated_at:
                    ops.push(DELETE_LOCAL, key)  // deletion wins
                else:
                    ops.push(RESURRECT_REMOTE, key)  // local modification wins
            
            else:  // neither deleted
                if local.content_hash == remote.content_hash:
                    ops.push(NOOP)  // same value
                else if local.updated_at > remote.updated_at:
                    ops.push(UPDATE_REMOTE, key)  // local is newer
                else if remote.updated_at > local.updated_at:
                    ops.push(UPDATE_LOCAL, key)  // remote is newer
                else:
                    // identical timestamps, different hashes -- true conflict
                    ops.push(CONFLICT, key)
    
    return ops
```

### Operation Types

```javascript
const SyncOp = {
    NOOP: 'noop',
    INSERT_LOCAL: 'insert_local',     // copy remote → local
    INSERT_REMOTE: 'insert_remote',   // copy local → remote
    UPDATE_LOCAL: 'update_local',     // overwrite local with remote
    UPDATE_REMOTE: 'update_remote',   // overwrite remote with local
    DELETE_LOCAL: 'delete_local',     // soft-delete local
    DELETE_REMOTE: 'delete_remote',   // soft-delete remote
    RESURRECT_LOCAL: 'resurrect_local',   // un-delete local, copy remote value
    RESURRECT_REMOTE: 'resurrect_remote', // un-delete remote, copy local value
    CONFLICT: 'conflict',            // manual resolution needed
}
```

### Deliverables
- `src/core/sync-merge.js` -- `compute_diff(local_manifest, remote_manifest)` function
- `SyncOp` constants
- Comprehensive tests covering all branches of the algorithm

## Phase 4: Sync Executor

### Goal
Apply a diff to both local and remote vaults.

### Design

The executor takes the diff output and the two storage instances (local and remote) and applies the operations. For remote operations over a transport (SSH, file), the executor delegates to a transport adapter.

```javascript
async function apply_diff(diff, local_storage, remote_adapter, options) {
    const log = []
    
    for (const op of diff) {
        switch (op.type) {
            case SyncOp.INSERT_REMOTE:
                const secret = await local_storage.fetch_secret(op.app, op.env, op.key)
                await remote_adapter.write_secret(secret)
                log.push({ op: 'insert', direction: 'push', ...op })
                break
            case SyncOp.INSERT_LOCAL:
                const secret = await remote_adapter.read_secret(op.app, op.env, op.key)
                await local_storage.add_secret(secret)
                log.push({ op: 'insert', direction: 'pull', ...op })
                break
            // ... other operations
        }
    }
    
    return log
}
```

### Transaction Safety

- Local operations are wrapped in a SQLite transaction. If any operation fails, all local changes roll back.
- Remote operations depend on the transport. SSH transport uses the sync-agent which also wraps in a transaction. File transport uses a staging database that is swapped atomically.
- If the local side commits but the remote side fails, the sync is marked as partial. The next sync will detect the asymmetry and correct it.

### Sync Log

Each sync produces a log entry stored in a `sync_log` table:

```sql
CREATE TABLE IF NOT EXISTS sync_log (
    id          TEXT PRIMARY KEY,
    link_id     TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    completed_at TEXT,
    status      TEXT NOT NULL,       -- 'success', 'partial', 'failed'
    ops_pushed  INTEGER DEFAULT 0,
    ops_pulled  INTEGER DEFAULT 0,
    ops_deleted INTEGER DEFAULT 0,
    conflicts   INTEGER DEFAULT 0,
    details     TEXT                 -- JSON array of operation details
);
```

### Deliverables
- `src/core/sync-executor.js` -- `apply_diff()` function
- Migration adding `sync_log` table
- Sync log writing and querying
- `jseeqret sync-log [link-name]` CLI command
- Tests for executor with mocked storage

## Phase 5: Dry Run and Conflict Resolution

### Goal
Let users preview sync results and handle conflicts.

### Dry Run

```bash
jseeqret sync home --dry-run
```

Output:
```
Sync preview for 'home' (ssh://bp@home:/srv/.seeqret):
  + myapp:dev:NEW_API_KEY          → push (new locally)
  ← myapp:dev:DB_PASSWORD          ← pull (remote is newer)
  × myapp:dev:CACHE_URL            ✗ conflict (same timestamp, different values)
  - myapp:dev:OLD_TOKEN             → delete remote (deleted locally 2h ago)
  
  3 changes, 1 conflict. Run without --dry-run to apply.
```

### Conflict Resolution

For the initial implementation, true conflicts (identical timestamps, different hashes) are rare and handled by:
1. Logging the conflict with both values.
2. Keeping the local value (local-wins tiebreaker).
3. Marking the conflict in the sync log for review.

Future enhancement: interactive conflict resolution mode where the user picks a winner.

### Deliverables
- `--dry-run` flag on `jseeqret sync`
- Formatted diff output for CLI
- Conflict logging and local-wins tiebreaker
- Tests for dry-run output formatting

## Phase 6: Tombstone Garbage Collection

### Goal
Prevent tombstones from accumulating indefinitely.

### Strategy

Tombstones are safe to hard-delete when:
1. All linked vaults have synced after the `deleted_at` timestamp (checked via `links.last_sync`), OR
2. The tombstone is older than a configurable retention period (default: 30 days).

```bash
jseeqret gc                  # garbage-collect tombstones
jseeqret gc --retention 7d   # shorter retention period
jseeqret gc --dry-run        # preview what would be removed
```

### Deliverables
- `src/core/gc.js` -- tombstone garbage collection logic
- `jseeqret gc` CLI command
- Tests for GC with various link/sync states

## Testing Strategy

The sync-merge module is pure logic and highly testable:

1. **Unit tests for `compute_diff`** -- exhaustive coverage of the state matrix (all combinations from the merge rules table).
2. **Property-based tests** -- generate random manifest pairs and verify that sync is idempotent (syncing twice produces no additional operations).
3. **Integration tests** -- create two temporary vaults, make independent changes, sync, and verify both vaults are identical.
4. **Clock skew tests** -- verify behavior when timestamps are within the warning threshold.
5. **Transaction tests** -- verify rollback on partial failure.

## Implementation Order

```
Phase 1: Schema (tombstones)           ← no dependencies
Phase 2: Manifest                      ← depends on Phase 1
Phase 3: Diff algorithm                ← depends on Phase 2
Phase 4: Executor                      ← depends on Phase 3
Phase 5: Dry run + conflict resolution ← depends on Phase 4
Phase 6: Garbage collection            ← depends on Phase 1
```

Phases 1 and 6 can be developed in parallel. Phases 2-5 are sequential.
