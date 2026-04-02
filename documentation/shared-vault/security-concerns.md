# Shared Vault -- Security Concerns

## 1. Advisory ACL Is Not a Security Boundary

**Risk**: High | **Category**: Access control

This is the most significant security concern in the entire shared vault design. The ACL in `acl.json` is enforced by the CLI and GUI, not by cryptography. Anyone with access to `seeqret.key` can:
- Read all secrets directly from `seeqrets.db` using any SQLite tool.
- Bypass all ACL rules by using raw SQL queries.
- Modify or delete `acl.json` itself to grant themselves admin access.

The plan acknowledges this explicitly, but the risk deserves emphasis: **in Model B, access control is a UX feature, not a security feature**.

**Mitigation**:
- Document this limitation prominently in user-facing documentation.
- Consider adding a startup warning when a shared vault has no ACL file.
- For environments that need real access control, push users toward the vault service (Plan B) or separate vaults.

## 2. User Identity Spoofing

**Risk**: High | **Category**: Authentication

The current user identity is determined by `--user` flag, `JSEEQRET_USER` env var, or OS username -- none of which are cryptographically verified. Any user with shell access can:
- Set `--user alice` to impersonate Alice in audit trails.
- Write to `created_by` and `updated_by` columns with any identity.
- Fulfill secret requests under a false identity.

The audit trail is therefore untrustworthy in adversarial environments.

**Mitigation**: The plan notes this in Security Consideration #3. For v1, document that audit columns are trustworthy only in cooperative environments. For future versions, require NaCl signatures on write operations to cryptographically bind changes to a user's keypair.

## 3. Shared `seeqret.key` Distribution

**Risk**: High | **Category**: Key management

All users of a shared vault need a copy of `seeqret.key`. This creates multiple problems:
- **Distribution channel**: How does the key get to each user? Email, chat, USB drive? Each channel has its own risks.
- **Key proliferation**: The more copies of the key exist, the harder it is to track who has it.
- **Revocation impossible without rotation**: You cannot revoke one user's access without rotating the key and re-encrypting all secrets.

Phase 4 addresses key distribution via NaCl-encrypted key sharing (`jseeqret key share`), which is good. But the fundamental problem remains: shared symmetric keys are hard to manage.

**Mitigation**: The NaCl-encrypted key sharing in Phase 4 is the right approach. Emphasize that key rotation on member removal is not optional -- it's mandatory. Consider implementing automatic key rotation reminders when a user is removed from the ACL.

## 4. Key Rotation Is Expensive and Disruptive

**Risk**: Medium | **Category**: Operational security

When a team member leaves, `seeqret.key` must be rotated, which requires:
1. Generating a new key.
2. Decrypting every secret with the old key.
3. Re-encrypting every secret with the new key.
4. Distributing the new key to all remaining team members.
5. Every running application must reload with the new key.

For a vault with hundreds of secrets and multiple consumers, this is a complex, error-prone operation. If any step fails midway, the vault could end up with a mix of old-key and new-key encrypted secrets.

**Mitigation**: The `jseeqret key rotate` command must be transactional -- all secrets are re-encrypted atomically (within a single SQLite transaction). Include a `--dry-run` flag. Create a backup of the database before rotation. Provide a rollback mechanism.

## 5. SQLite Over Network Shares Is Fragile

**Risk**: Medium | **Category**: Data corruption

SQLite's documentation explicitly warns against use over network filesystems. Even with WAL mode:
- NFS and SMB do not guarantee the locking semantics SQLite relies on.
- A network hiccup during a write can corrupt the database.
- WAL mode creates `-wal` and `-shm` files that must be on the same filesystem.

A corrupted `seeqrets.db` means all secrets are lost (unless backed up).

**Mitigation**:
- Warn users that shared vaults on network shares risk corruption.
- Recommend the vault service (Plan B) for reliable multi-user access.
- Implement automatic database backups before write operations.
- The lockfile coordination for network shares is a good fallback but not a guarantee.

## 6. ACL File Can Be Deleted or Modified

**Risk**: Medium | **Category**: Authorization bypass

`acl.json` is a regular file in the vault directory. Any user with write access to the vault directory can:
- Delete `acl.json` to remove all access restrictions (the plan says no ACL = open access).
- Modify rules to grant themselves admin access.
- Replace the file with a version that removes other users' access (denial of service).

**Mitigation**: Consider storing ACL rules in the database rather than a separate file (harder to modify without the tooling). If keeping the file, add a hash or signature of `acl.json` in the database that the tooling checks on load. Document that filesystem permissions on `acl.json` should restrict write access to admins only.

## 7. Implicit Admin on Vault Creator

**Risk**: Low | **Category**: Privilege management

Open Question #2 asks whether the vault creator should always be an implicit admin. If yes, this identity is based on the OS username at creation time (not cryptographically verified). If the creator's OS account is renamed or reassigned, the implicit admin identity becomes stale or points to a different person.

**Mitigation**: Store the implicit admin's public key (not just username) at vault creation time. Verify admin identity cryptographically when possible.

## 8. `acl.json` Expiration Not Enforced Offline

**Risk**: Low | **Category**: Access control

ACL rules can have an `expires_at` field (e.g., contractor access). Expiration is checked by the CLI/GUI at runtime. If the contractor copies the vault's `seeqret.key` before their access expires, they retain the ability to decrypt secrets indefinitely -- the ACL expiration doesn't revoke the key.

**Mitigation**: Key rotation when a time-limited user's access expires. Document that ACL expiration is not a substitute for key rotation.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | Advisory ACL is bypassable | High | Document prominently, push toward vault service |
| 2 | User identity is spoofable | High | Document limitation, plan NaCl signatures |
| 3 | Shared key distribution is risky | High | NaCl key sharing + mandatory rotation |
| 4 | Key rotation is disruptive | Medium | Transactional rotation with backup |
| 5 | SQLite on network shares corrupts | Medium | Warn users, recommend vault service |
| 6 | ACL file can be tampered with | Medium | Sign or hash ACL, restrict permissions |
| 7 | Implicit admin based on username | Low | Use public key for admin identity |
| 8 | ACL expiration doesn't revoke keys | Low | Rotate keys on access expiration |
