# Auto-Rotation -- Implementation Plan

## Overview

Auto-rotation adds expiration and rotation tracking to secrets. This is a Phase 1 (Foundation) feature from the roadmap -- it has no external dependencies and high standalone value. The schema changes are backward-compatible with the Python `seeqret` tool.

## Phase 1: Schema Changes

### Goal
Add expiration and rotation columns to the `secrets` table.

### Migration

```sql
ALTER TABLE secrets ADD COLUMN expires_at TEXT DEFAULT NULL;
ALTER TABLE secrets ADD COLUMN rotated_at TEXT DEFAULT NULL;
```

Both columns are ISO 8601 timestamps, nullable. Existing secrets have `NULL` for both (no expiration, unknown rotation time).

### Python Compatibility

The migration is backward-compatible:
- The Python `seeqret` tool will ignore columns it doesn't know about.
- jseeqret uses `column_exists()` checks before querying these columns, so it works with both old and new databases.
- Coordinate with the Python project to add the same columns in a future release.

### Model Changes

Add to `Secret` class:

```javascript
class Secret {
    // existing fields...
    expires_at = null    // ISO 8601 string or null
    rotated_at = null    // ISO 8601 string or null

    is_expired() {
        if (!this.expires_at) return false;
        return new Date(this.expires_at) < new Date()
    }

    expires_soon(days = 7) {
        if (!this.expires_at) return false;
        const threshold = new Date()
        threshold.setDate(threshold.getDate() + days)
        return new Date(this.expires_at) < threshold
    }

    days_until_expiry() {
        if (!this.expires_at) return null;
        const diff = new Date(this.expires_at) - new Date()
        return Math.ceil(diff / (1000 * 60 * 60 * 24))
    }
}
```

### Storage Changes

- `SqliteStorage.add_secret()` accepts optional `expires_at` parameter.
- `SqliteStorage.update_secret()` sets `rotated_at = now()` on every update. Optionally accepts a new `expires_at`.
- `SqliteStorage.fetch_secrets()` includes `expires_at` and `rotated_at` in results (when columns exist).

### CLI Changes

```powershell
# Add a secret with expiration
jseeqret add API_KEY --app myapp --env prod --value "key123" --expires "2026-07-01"

# Update with new expiration
jseeqret update API_KEY --app myapp --env prod --value "key456" --expires "2026-10-01"

# Show expiration in list output
jseeqret list --app myapp
```

List output with expiration:

```
  APP      ENV    KEY              EXPIRES      STATUS
  myapp    prod   API_KEY          2026-07-01   ok
  myapp    prod   DB_PASSWORD      2026-04-05   expires in 4 days!
  myapp    prod   OLD_TOKEN        2026-03-15   EXPIRED
  myapp    prod   ENCRYPTION_KEY   -            no expiration
```

### Deliverables
- Migration adding `expires_at` and `rotated_at` columns
- Updated `Secret` model with expiration methods
- Updated `SqliteStorage` methods
- `--expires` option on `add` and `update` CLI commands
- Expiration column in `list` output
- Tests for expiration logic, migration, and backward compatibility

## Phase 2: Audit Command

### Goal
A single command to check the health of all secrets in a vault.

### Command

```powershell
# Show all secrets with expiration issues
jseeqret audit

# Only warn about secrets expiring within N days
jseeqret audit --warn-days 14

# Filter by app/env
jseeqret audit --app myapp --env prod

# Machine-readable output for CI/CD pipelines
jseeqret audit --format json

# Non-zero exit code if any secrets are expired (for CI gates)
jseeqret audit --strict
```

### Output

```
jseeqret audit --warn-days 14

  EXPIRED (action required):
    myapp:prod:OLD_TOKEN          expired 2026-03-15 (17 days ago)

  EXPIRING SOON (within 14 days):
    myapp:prod:DB_PASSWORD        expires 2026-04-05 (4 days remaining)

  NEVER ROTATED (no rotated_at):
    myapp:prod:LEGACY_KEY         added 2025-06-01 (304 days ago)

  Summary: 1 expired, 1 expiring soon, 1 never rotated, 12 healthy
```

### JSON Output

```json
{
    "expired": [
        {
            "app": "myapp", "env": "prod", "key": "OLD_TOKEN",
            "expires_at": "2026-03-15T00:00:00Z",
            "days_overdue": 17
        }
    ],
    "expiring_soon": [
        {
            "app": "myapp", "env": "prod", "key": "DB_PASSWORD",
            "expires_at": "2026-04-05T00:00:00Z",
            "days_remaining": 4
        }
    ],
    "never_rotated": [
        {
            "app": "myapp", "env": "prod", "key": "LEGACY_KEY",
            "created_at": "2025-06-01T00:00:00Z",
            "days_since_creation": 304
        }
    ],
    "healthy": 12,
    "total": 15
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All secrets healthy (no expired, no expiring soon) |
| 1 | At least one secret expired |
| 2 | No expired secrets, but at least one expiring soon |

### Deliverables
- `src/cli/commands/audit.js` -- audit command
- `src/core/audit.js` -- audit logic (query secrets, categorize by status)
- JSON and human-readable output formatters
- Tests for audit categorization and output

## Phase 3: Expiration Warnings in API

### Goal
Warn applications when they read an expired secret.

### Behavior

When `get_sync()` returns an expired secret:

```javascript
const value = get_sync('API_KEY', 'myapp', 'prod')
// Logs to stderr: "[jseeqret] WARNING: secret myapp:prod:API_KEY expired 2026-03-15 (17 days ago)"
// Returns the value anyway (does not throw)
```

### Configuration

```javascript
await init({
    on_expired: 'warn',     // default: log warning, return value
    // on_expired: 'throw', // throw an error
    // on_expired: 'allow', // silent, no warning
})
```

### Expiring-Soon Callback

```javascript
await init({
    on_expiring_soon: (secret, days_remaining) => {
        console.warn(`${secret.key} expires in ${days_remaining} days`)
    },
    expiring_soon_days: 7,
})
```

The callback is invoked during `init()` for all secrets that are expiring soon, and again on `reload()`.

### Deliverables
- Expiration check in `get_sync()`
- `on_expired` configuration option in `init()`
- `on_expiring_soon` callback
- Tests for warning behavior, configuration options

## Phase 4: Rotation Propagation

### Goal
When a secret is rotated, ensure all dependent vaults and applications are updated.

### Via Linked Vault Sync

Rotation sets a new `updated_at` timestamp. The [sync-merge](../sync-merge/) algorithm naturally propagates the new value on the next sync. No special handling needed -- rotation is just an update.

### Via Vault-to-Vault Push

After rotating a secret, push the new value to known recipients:

```powershell
# Rotate and push to server
jseeqret update DB_PASSWORD --app myapp --env prod --value "newpass" --expires "2026-10-01"
jseeqret push --vault server-prod --filter "myapp:prod:DB_PASSWORD"
```

### Via Shared Vault

In a shared vault, rotation is immediately visible to all users (same database). Running applications need a `reload()` trigger (file watcher or manual).

### Notification via Audit

The audit command can identify who needs to be notified about a rotation by checking the ACL (if present) or the user list:

```powershell
jseeqret audit --rotated-since "2026-04-01" --notify
```

This lists recently rotated secrets and the users/vaults that should be updated.

### Deliverables
- `--rotated-since` filter on audit command
- Integration with linked vault sync (automatic, no new code)
- Integration with vault-to-vault push (manual, existing commands)
- Documentation of rotation propagation patterns

## Phase 5: GUI Integration

### Goal
Expiration and rotation management in the Electron GUI.

### Design
- **Expiration badges**: Secrets in the list view show visual indicators (green/yellow/red) based on expiration status.
- **Set expiration dialog**: When adding or editing a secret, set an optional expiration date with a date picker.
- **Audit dashboard**: Overview of vault health -- expired count, expiring soon count, never-rotated count.
- **Rotation history**: View when a secret was last rotated (from `rotated_at` column).

### Deliverables
- Expiration status indicators in secret list
- Expiration date picker in add/edit dialogs
- Audit dashboard component
- IPC handlers for audit queries

## Security Considerations

1. **Expired secrets are still accessible**: This is by design. Blocking access to expired secrets could crash production applications. The warning approach balances security awareness with operational stability.
2. **Rotation ≠ revocation**: Rotating a secret in jseeqret does not revoke the old value at the provider. The admin must also rotate the credential at the source (database, API provider, etc.).
3. **Clock accuracy**: Expiration checks depend on the local system clock. If the clock is wrong, secrets may appear expired when they're not (or vice versa). This is acceptable for warnings but would be problematic if expiration were enforced.

## Open Questions

1. **Default expiration**: Should new secrets have a default expiration (e.g., 90 days)? This encourages rotation hygiene but may be annoying for long-lived secrets. Recommendation: no default, but the audit command highlights secrets without any expiration set.
2. **Rotation history table**: Should there be a `rotation_history` table that records previous values? Useful for rollback, but increases the security surface. Recommendation: not for v1.
3. **Provider integration**: Should jseeqret support calling external APIs to rotate credentials (e.g., AWS IAM key rotation)? This is complex and provider-specific. Recommendation: out of scope for v1. Document as a future extension point.
