# Linked Vault -- Security Concerns

## 1. Cloud Sync Folder as Attack Surface

**Risk**: High | **Category**: Confidentiality

The primary transport is a cloud-synced directory (OneDrive, Dropbox, Google Drive). This means encrypted sync bundles are uploaded to a third-party cloud service. While secrets in `outbox.json` are NaCl-encrypted, the threat model now includes:
- **Cloud provider compromise**: The provider (or a rogue employee) can observe sync patterns, file sizes, and frequency. They cannot read secret values but can infer activity.
- **Cloud account compromise**: If the user's Microsoft/Google/Dropbox account is compromised (phishing, credential stuffing), the attacker gets access to all sync bundles. The NaCl encryption protects values, but the attacker gets the full manifest (secret names, apps, environments, timestamps).
- **Cloud sync client vulnerabilities**: A compromised sync client on either machine could modify sync bundles in transit.

**Mitigation**: The plan correctly uses NaCl encryption as defense-in-depth. Consider encrypting the manifest as well (currently it contains metadata in plaintext). Warn users that cloud account security is critical when using cloud-based sync.

## 2. Manifest Exposes Secret Inventory

**Risk**: Medium | **Category**: Information disclosure

`manifest.json` contains `(app, env, key, updated_at, deleted_at)` tuples in plaintext. Anyone with access to the sync directory (cloud account, network share, USB drive finder) learns the complete inventory of secrets -- their names, which applications use them, and when they were last changed. This is valuable reconnaissance for an attacker.

**Mitigation**: The plan acknowledges this in Security Consideration #3 and suggests encrypting the manifest with the sync key. This should be promoted from "v1 acceptable" to "implement in v1" -- the manifest should be encrypted by default when using cloud sync folders.

## 3. Stale Outbox Files

**Risk**: Medium | **Category**: Data exposure

The sync directory accumulates `outbox.json` files containing NaCl-encrypted secrets. If these files are not cleaned up after successful sync, they persist on the cloud provider's storage (and in their backups) indefinitely. Even if the secrets are later rotated, the old encrypted values remain in the sync directory.

**Mitigation**: After a successful sync, both sides should delete their consumed outbox files. The plan should define a cleanup protocol. Old outbox files should be treated as stale and automatically purged (e.g., after 7 days).

## 4. Lockfile Bypass and Race Conditions

**Risk**: Low | **Category**: Integrity

The `sync.lock` file prevents concurrent writes, with a 5-minute stale timeout. For network shares, an attacker (or a crashed process) could hold the lock indefinitely, preventing legitimate syncs (denial of service). Conversely, the forced removal of stale locks could cause data corruption if a legitimately slow sync is still in progress.

**Mitigation**: Use `fs.mkdirSync()` for atomic lock acquisition (as planned). Consider a heartbeat mechanism for long-running syncs that updates the lock timestamp periodically.

## 5. No Authentication of Sync Bundles

**Risk**: High | **Category**: Integrity

The outbox files are NaCl-encrypted (authenticated encryption), which prevents tampering with the ciphertext. However, the manifest is not signed. An attacker with write access to the sync directory could:
- **Replace the manifest** with a crafted version that omits certain secrets, causing the syncing vault to delete them (thinking they were deleted on the other side).
- **Replay an old manifest** to roll back the sync state.

**Mitigation**: The manifest should be signed with the source vault's private key. The receiving vault should verify the signature before trusting any manifest data.

## 6. Shared Sync Key Weakens Isolation

**Risk**: Medium | **Category**: Key management

The plan mentions a possible optimization: "encrypt with a shared sync key derived from both vaults' symmetric keys" instead of NaCl. If implemented, this shared key becomes a single point of compromise -- leaking it exposes all sync traffic in both directions. It also ties the two vaults' security together.

**Mitigation**: Stick with NaCl (as the plan recommends for v1). Each message is encrypted with the recipient's public key, maintaining vault independence.

## 7. File Transport Path Traversal

**Risk**: Medium | **Category**: Injection

The `address` field in the `links` table stores a user-provided file path. If this path is not validated, an attacker who can modify the links table (or the CLI input) could point the sync to an arbitrary directory, potentially overwriting files outside the intended sync directory.

**Mitigation**: Validate that the sync address resolves to a directory (not a file), exists, and does not contain path traversal sequences (`..`). Canonicalize paths with `path.resolve()` before use.

## 8. Cloud Sync Latency Creates a Window

**Risk**: Low | **Category**: Availability/Consistency

The 1-30 second cloud sync delay means there is a window where one vault has written updated secrets but the other hasn't received them yet. During this window, the two vaults are inconsistent. If a security-critical rotation happens (e.g., compromised API key), the delay means the old key remains in the remote vault.

**Mitigation**: For urgent rotations, users should use direct vault-to-vault push rather than relying on cloud sync latency. Document that linked vault sync is eventual consistency, not real-time.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | Cloud sync folder as attack surface | High | Encrypt manifest, warn about cloud account security |
| 2 | Manifest exposes secret inventory | Medium | Encrypt manifest in v1 |
| 3 | Stale outbox files persist | Medium | Define cleanup protocol |
| 4 | Lockfile bypass/race conditions | Low | Heartbeat for long syncs |
| 5 | Unsigned manifests allow tampering | High | Sign manifests with vault key |
| 6 | Shared sync key weakens isolation | Medium | Use NaCl per-message encryption |
| 7 | Path traversal in sync address | Medium | Validate and canonicalize paths |
| 8 | Cloud sync latency window | Low | Document as eventual consistency |
