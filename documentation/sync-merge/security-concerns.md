# Sync-Merge -- Security Concerns

## 1. Last-Write-Wins Can Silently Overwrite Secrets

**Risk**: High | **Category**: Data integrity

The LWW conflict resolution strategy means that a newer timestamp always wins, even if the older value was intentionally set. An attacker who can write to one vault and set a future timestamp can overwrite secrets in all linked vaults during the next sync. More practically, an admin who rotates a secret on one machine and doesn't realize another machine has a stale cached version with a slightly later timestamp will have the rotation silently undone.

**Mitigation**:
- The sync log must record every overwrite with both old and new values (encrypted).
- The `--dry-run` flag is essential and should be the default for first-time syncs between newly linked vaults.
- Consider adding a `--confirm` mode for high-value secrets where the user must approve each overwrite.

## 2. Tombstone Manipulation for Secret Deletion

**Risk**: High | **Category**: Integrity

Soft deletes use a `deleted_at` timestamp. An attacker who can write a tombstone record (with `deleted_at` set to a recent timestamp) to one vault can cause that secret to be deleted from all linked vaults during the next sync. This is a targeted deletion attack that propagates through the sync network.

**Mitigation**:
- Tombstones should be signed by the user who performed the deletion.
- During sync, the receiving vault should verify that the deleter had the authority to delete (via ACL check if available).
- Consider requiring explicit confirmation before propagating deletions during sync.

## 3. Clock Skew Exploits

**Risk**: Medium | **Category**: Integrity

The algorithm relies on `updated_at` and `deleted_at` timestamps for all conflict resolution. Clock skew between machines creates several attack vectors:
- A machine with a clock set ahead can always win LWW conflicts.
- A machine with a clock set behind will never have its changes propagate.
- The 5-second warning threshold may be too generous -- even 2-3 seconds of skew can cause incorrect resolution for near-simultaneous edits.

**Mitigation**: Log clock skew warnings prominently (not just in the sync log). Consider using vector clocks or Lamport timestamps instead of wall-clock time for future versions. At minimum, record the source machine's clock time alongside the sync operation so discrepancies can be forensically detected.

## 4. Content Hash Does Not Prevent Replay

**Risk**: Medium | **Category**: Integrity

The content hash (SHA-256 of the Fernet token) detects identical values but does not prevent an attacker from replaying an old, valid encrypted value. If an attacker captures an old `outbox.json` containing a previous version of a secret, they can replay it with a manipulated `updated_at` timestamp to overwrite the current value with the old one.

**Mitigation**: Include a sequence number or version counter per secret that monotonically increases. Reject sync operations where the incoming version is not strictly greater than the local version. This prevents replay of older values regardless of timestamp manipulation.

## 5. Sync Log as a Forensic Target

**Risk**: Medium | **Category**: Information disclosure

The `sync_log` table records every sync operation with details including which secrets were pushed, pulled, or deleted. This is valuable for auditing but also for reconnaissance -- an attacker who reads the sync log learns the complete history of secret changes, sync patterns, and linked vault relationships.

**Mitigation**: The `details` column (JSON array of operation details) should not contain plaintext secret values. Consider encrypting the details column or storing only secret identifiers (app:env:key) and operation types.

## 6. Partial Sync Leaves Asymmetric State

**Risk**: Medium | **Category**: Consistency

If the local side commits but the remote side fails, the plan marks the sync as "partial." The next sync should correct this, but in the interim:
- One vault has the new state, the other has the old state.
- If the partial sync pushed deletions to the local side, secrets may be missing locally that still exist remotely.
- If the partial sync pushed updates to the remote side, the remote has new values but the local side doesn't know the push succeeded.

**Mitigation**: The local transaction should not commit until the remote side confirms success. If true atomicity across both sides is impossible (it often is), the sync executor should favor leaving the local side unchanged on remote failure. Never commit local deletions until the remote side confirms the deletion was received.

## 7. Tombstone Garbage Collection Timing

**Risk**: Low | **Category**: Data integrity

Tombstones are garbage-collected when all linked vaults have synced past the `deleted_at` timestamp, or after 30 days. If a vault is offline for longer than the retention period, it will miss the deletion and the secret will reappear (zombie resurrection) when that vault finally syncs.

**Mitigation**: The GC command should warn if any linked vault has a `last_sync` older than the retention period. Consider extending retention automatically for vaults with stale `last_sync`. Document the maximum offline window for linked vaults.

## 8. CONFLICT Resolution Defaults to Local-Wins

**Risk**: Low | **Category**: Data integrity

True conflicts (identical timestamps, different hashes) default to local-wins. This means:
- The local vault's value always survives, and the remote value is silently discarded.
- If both sides have this policy, each side keeps its own value -- the vaults diverge permanently for that secret.
- There is no notification to the user that a conflict occurred (beyond the sync log).

**Mitigation**: Conflicts should produce a visible warning (not just a log entry). Consider requiring explicit resolution for secrets tagged as critical. The conflict count in the sync log should be surfaced in the CLI output.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | LWW silently overwrites secrets | High | Sync log + dry-run default for new links |
| 2 | Tombstone manipulation deletes secrets | High | Sign tombstones, verify authority |
| 3 | Clock skew exploits | Medium | Log warnings, consider version vectors |
| 4 | Content hash doesn't prevent replay | Medium | Add monotonic version counter |
| 5 | Sync log reveals change history | Medium | Don't store plaintext values in log |
| 6 | Partial sync creates asymmetry | Medium | Don't commit local on remote failure |
| 7 | GC causes zombie resurrection | Low | Warn on stale linked vaults |
| 8 | Conflict resolution is silent | Low | Surface conflict warnings in CLI |
