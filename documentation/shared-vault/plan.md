# Shared Vault -- Implementation Plan

## Overview

Shared vault lets multiple users access the same vault database. This plan starts with advisory ACLs (Model B) since it requires no new infrastructure, and layers audit columns for accountability. Service-mediated access (Model C) is deferred to the vault service phase.

## Phase 1: Audit Columns

### Goal
Track who created and last modified each secret.

### Migration

```sql
ALTER TABLE secrets ADD COLUMN created_by TEXT DEFAULT NULL;
ALTER TABLE secrets ADD COLUMN updated_by TEXT DEFAULT NULL;
```

These columns are nullable so existing secrets (pre-migration) don't break. New secrets and updates populate them with the current user's identity.

### User Identity

The current user is determined by:
1. `--user` CLI option (explicit).
2. `JSEEQRET_USER` environment variable.
3. OS username (`os.userInfo().username`).

The identity is stored in audit columns as a plain string. It is not cryptographically verified in Model B (advisory ACL). Model C (vault service) would use NaCl signatures for verified identity.

### Storage Changes

- `SqliteStorage.add_secret()` accepts an optional `user` parameter, writes to `created_by` and `updated_by`.
- `SqliteStorage.update_secret()` accepts an optional `user` parameter, writes to `updated_by`.
- `SqliteStorage.fetch_secrets()` includes audit columns in results.
- `Secret` model gains `created_by` and `updated_by` fields.

### Deliverables
- Migration adding audit columns
- Updated `SqliteStorage` methods with `user` parameter
- Updated `Secret` model
- `--user` global CLI option
- Tests for audit column population

## Phase 2: Access Control List

### Goal
Define who can access which secrets, enforced by the CLI and GUI.

### ACL File

An `acl.json` file in the vault directory:

```json
{
    "version": 1,
    "rules": [
        {
            "user": "alice",
            "role": "admin",
            "filter": "*:*:*"
        },
        {
            "user": "bob",
            "role": "read-write",
            "filter": "myapp:*:*"
        },
        {
            "user": "charlie",
            "role": "read-only",
            "filter": "myapp:staging:*"
        },
        {
            "user": "contractor-dave",
            "role": "read-only",
            "filter": "myapp:staging:*",
            "expires_at": "2026-06-01T00:00:00Z"
        }
    ]
}
```

### Roles

| Role         | Permissions                                   |
| ------------ | --------------------------------------------- |
| `admin`      | Read, write, delete, manage ACL, manage users |
| `read-write` | Read and write secrets matching the filter    |
| `read-only`  | Read secrets matching the filter              |

### ACL Module

```
src/core/acl.js
```

Public API:
- `load_acl(vault_dir)` -- reads `acl.json`, returns parsed rules. Returns `null` if no ACL file exists (open access, backward-compatible).
- `check_access(acl, user, action, secret)` -- returns `true` if the user is permitted the action on the secret. Actions: `read`, `write`, `delete`, `admin`.
- `save_acl(vault_dir, acl)` -- writes `acl.json` atomically.

### Enforcement Points

- `SqliteStorage` gains an optional `acl` parameter. When set, all operations check permissions before proceeding.
- CLI commands load the ACL and pass it to storage operations.
- The GUI enforces ACL by disabling UI controls the user doesn't have access to.

### Advisory Nature

The ACL is enforced by the **tooling**, not by encryption. Anyone with access to `seeqret.key` and the database file can bypass the ACL using raw SQLite queries. This is acceptable for small teams with trust. For enforceable access control, use the vault service (Phase 4).

### CLI Commands

```powershell
# View current ACL
jseeqret acl show

# Add a rule
jseeqret acl add bob --role read-write --filter "myapp:*:*"

# Remove a rule
jseeqret acl remove bob

# Update a rule
jseeqret acl update bob --role read-only --filter "myapp:staging:*"
```

### Deliverables
- `src/core/acl.js` module
- ACL enforcement in `SqliteStorage`
- `src/cli/commands/acl.js` -- ACL management commands
- Tests for ACL loading, permission checks, enforcement

## Phase 3: Concurrent Access

### Goal
Allow multiple users to read and write the vault database safely.

### SQLite Concurrency

SQLite supports concurrent readers with a single writer when using WAL (Write-Ahead Logging) mode. This works well for local filesystems but is unreliable on network shares.

### Strategy by Access Pattern

| Access Pattern           | Strategy                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Shared local directory   | WAL mode. Multiple readers, single writer with automatic retry.                                   |
| Network share (UNC path) | Lockfile coordination. Only one writer at a time; readers don't need the lock.                    |
| Cloud sync folder        | Not recommended for shared vaults (conflict-prone). Use [linked vault](../linked-vault/) instead. |
| Vault service            | Service serializes all writes. No concurrency issues at the database level.                       |

### WAL Mode

Enable WAL mode on database open:

```javascript
db.run('PRAGMA journal_mode=WAL')
```

WAL mode allows concurrent reads while a write is in progress. Write conflicts result in an `SQLITE_BUSY` error, which should be retried with exponential backoff.

### Lockfile for Network Shares

For vaults on network shares, use a lockfile:

```javascript
// Acquire write lock
const lock_path = path.join(vault_dir, '.seeqret.lock')
await acquire_lock(lock_path, { timeout: 30000 })
try {
    // perform write operations
} finally {
    await release_lock(lock_path)
}
```

### Deliverables
- WAL mode enablement in `SqliteStorage`
- Lockfile module for network share writes
- Retry logic for `SQLITE_BUSY` errors
- Tests for concurrent read/write scenarios

## Phase 4: Key Distribution

### Goal
Securely distribute `seeqret.key` to new team members.

### Workflow

When adding a new user to a shared vault:

1. Admin has the new user's public key (imported via `jseeqret user add`).
2. Admin runs `jseeqret acl add newuser --role read-write --filter "myapp:*:*"`.
3. Admin distributes `seeqret.key` encrypted with the new user's NaCl public key:
   ```powershell
   jseeqret key share --for newuser --output key-for-newuser.enc
   ```
4. New user decrypts and installs the key:
   ```powershell
   jseeqret key receive key-for-newuser.enc --vault work
   ```

### Key Rotation on Member Removal

When a user leaves the team:
1. Admin removes them from the ACL: `jseeqret acl remove exuser`.
2. Admin rotates the vault key: `jseeqret key rotate`.
3. This re-encrypts all secrets with the new key. The old key is invalidated.
4. Admin re-distributes the new key to remaining team members.

Key rotation is expensive (decrypts and re-encrypts every secret) but necessary for security.

### Deliverables
- `jseeqret key share` command
- `jseeqret key receive` command
- `jseeqret key rotate` command (re-encrypts all secrets)
- Tests for key distribution and rotation

## Phase 5: GUI Integration

### Goal
Shared vault management in the Electron GUI.

### Design
- **ACL editor**: Visual rule management with user picker, role selector, and filter pattern input.
- **Audit log viewer**: Timeline of who changed which secrets.
- **User management**: Add/remove users, share keys.
- **Permission indicators**: Read-only secrets are visually distinct from writable ones.

### Deliverables
- IPC handlers for ACL and user management
- Svelte components for ACL editor, audit log, and user management

## Security Considerations

1. **Advisory ACL is not security**: It prevents accidental access, not malicious access. Anyone with `seeqret.key` can read everything. For real security, use the vault service.
2. **Key rotation is essential**: When a team member leaves, rotate `seeqret.key`. The old key should be considered compromised.
3. **Audit columns are trustworthy only with a service**: In Model B, a user can spoof the `--user` flag. In Model C (service), identity is verified by NaCl signature.
4. **Network share risks**: SQLite over network shares is fragile. WAL mode helps but is not foolproof. For reliable shared access, prefer the vault service or linked vaults over shared filesystem.

## Open Questions

1. **ACL in database vs. file**: Starting with `acl.json` (file) is simpler and human-readable. Should we plan to migrate to a database table later? The file is easier to version-control with git.
2. **Implicit admin**: Should the vault creator always be an implicit admin, even if not listed in `acl.json`? Recommendation: yes, to prevent lock-out.
3. **Python compatibility**: The Python `seeqret` tool should ignore `acl.json` if it doesn't support ACLs (advisory enforcement means the file is inert to tools that don't read it).
