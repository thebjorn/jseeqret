# Sync-Merge

## Problem

When two vaults need to be synchronized, their contents may have diverged. Secrets may have been added, modified, or deleted independently in each vault since the last sync. We need a deterministic algorithm that merges the two states into a consistent result on both sides.

This is the **mechanism** that powers [linked vault](../linked-vault/) sync. It is designed as a standalone module so it can also be used for one-off merges, backup restoration, and vault migration.

## Merge Rules

Given vault **A** (local) and vault **B** (remote), for each secret identified by the tuple `(app, env, key)`:

| State in A                                                     | State in B                                                     | Action                         |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| Exists                                                         | Does not exist                                                 | Copy A → B                     |
| Does not exist                                                 | Exists                                                         | Copy B → A                     |
| Same value                                                     | Same value                                                     | No action                      |
| Different value, A newer                                       | Different value, B older                                       | Update B with A's value        |
| Different value, B newer                                       | Different value, A older                                       | Update A with B's value        |
| Deleted (tombstone), deletion newer than B's last modification | Exists                                                         | Delete from B                  |
| Exists                                                         | Deleted (tombstone), deletion newer than A's last modification | Delete from A                  |
| Deleted, but B was modified after deletion                     | Exists (modified after deletion)                               | Keep B's value, resurrect in A |
| Exists (modified after deletion)                               | Deleted, but A was modified after deletion                     | Keep A's value, resurrect in B |

"Newer" is determined by comparing `updated_at` timestamps (ISO 8601, UTC).

## Key Concepts

### Manifest
A lightweight representation of a vault's contents used for diffing without exchanging secret values. Each entry contains:
- `app`, `env`, `key` -- the secret identifier
- `updated_at` -- last modification timestamp
- `deleted_at` -- deletion timestamp (null if not deleted)
- `content_hash` -- hash of the encrypted value (to detect same-value situations without decrypting)

### Tombstone
When a secret is deleted, a record is kept with the `deleted_at` timestamp instead of being hard-deleted. This allows deletion to propagate to linked vaults during the next sync. Tombstones can be garbage-collected after all linked vaults have acknowledged the deletion (or after a configurable retention period).

### Diff
The result of comparing two manifests. A list of operations:
- `INSERT` -- secret exists on one side but not the other
- `UPDATE` -- secret exists on both sides with different values, one is newer
- `DELETE` -- secret was deleted on one side and should be deleted on the other
- `CONFLICT` -- (future) when automatic resolution is insufficient, flag for manual review
- `NOOP` -- no action needed

### Last-Write-Wins (LWW)
The default conflict resolution strategy. When two vaults have different values for the same secret, the one with the more recent `updated_at` timestamp wins. This is simple and predictable, but can silently overwrite changes. A sync log records what was overwritten so the user can review.

## Constraints

- **Clock skew**: Timestamps come from different machines. Significant clock skew can cause incorrect merge results. Mitigation: log warnings when timestamps are suspiciously close (within a configurable threshold, e.g., 5 seconds).
- **No central authority**: There is no "master" vault. Both sides are equal peers.
- **Idempotent**: Running sync twice with no intervening changes should produce no operations.
- **Atomic**: Either all changes from a sync apply, or none do. A partial sync should not leave either vault in an inconsistent state.

## Relationship to Other Features

| Feature                              | Relationship                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Linked Vault](../linked-vault/)     | Linked vault is the user-facing feature; sync-merge is the engine underneath.                                                                                    |
| [Vault-to-Vault](../vault-to-vault/) | Sync-merge can use the existing NaCl export/import as a transport layer.                                                                                         |
| [Auto-Rotation](../auto-rotation/)   | Rotated secrets have a new `updated_at` and propagate through sync naturally. Rotation metadata (`rotated_at`, `expires_at`) should be included in the manifest. |
| [Shared Vault](../shared-vault/)     | Shared vaults don't need sync-merge (everyone accesses the same database), but a shared vault could sync with a linked personal vault.                           |

## Open Questions

1. **Tombstone retention**: How long should tombstones be kept? Options: (a) until all linked vaults have synced past the deletion, (b) fixed TTL (e.g., 30 days), (c) manual cleanup via `jseeqret gc`.
2. **Merge preview**: Should `jseeqret sync --dry-run` show what would change without applying? Strongly recommended.
3. **Manual conflict resolution**: Should there be an interactive mode where the user can choose which value to keep? Or is LWW sufficient for the initial implementation?
4. **Type-aware merging**: If we add secret types (`str`, `json`, `file`), does the merge algorithm need to be type-aware? Probably not -- the value is opaque bytes regardless of type.
5. **Three-way merge**: With a common ancestor (the state at `last_sync`), we could do smarter merging. Worth the complexity? Probably not for v1.

## Documents

- [Implementation Plan](plan.md) -- algorithm design, data structures, and phased implementation
