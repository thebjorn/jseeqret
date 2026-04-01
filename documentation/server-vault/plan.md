# Server Vault -- Implementation Plan

## Overview

The server vault read path already works (`api.init()` + `get_sync()`). This plan focuses on the **admin write path** -- how an administrator pushes secrets to a server vault and triggers the running application to pick up changes.

## Phase 1: CLI-Based Administration (Local)

### Goal
A complete CLI workflow for managing secrets on the server, assuming the admin has shell access.

### Commands

These commands already exist or are trivial extensions of existing functionality:

```powershell
jseeqret add DB_PASSWORD --app myapp --env prod --value "s3cret"
jseeqret update DB_PASSWORD --app myapp --env prod --value "n3ws3cret"
jseeqret delete DB_PASSWORD --app myapp --env prod
jseeqret list --app myapp --env prod
```

### Reload Trigger

After modifying secrets, the admin needs to tell the running application to reload.

**Option A: File watcher** (recommended for v1)
- The application watches `seeqrets.db` for changes using `fs.watch()`.
- When the file changes, `api.reload()` is called automatically.
- Simple, no new dependencies, works on Windows and Linux.
- Caveat: `fs.watch()` can emit duplicate events on some platforms. Debounce with a 500ms delay.

**Option B: Signal-based** (Linux only)
- The application listens for `SIGHUP` and calls `api.reload()`.
- Admin runs `kill -HUP <pid>` after modifying secrets.
- Not available on Windows.

**Option C: Polling**
- The application polls `seeqrets.db` modification time every N seconds.
- Works everywhere but adds latency.

### Deliverables
- `api.watch()` method that sets up a file watcher and auto-reloads on changes
- `api.unwatch()` to stop watching
- Debounce logic for `fs.watch` events
- Tests for watch/reload cycle

## Phase 2: Remote Administration via Export/Import

### Goal
An admin pushes secrets from their local vault to the server vault without direct shell access to the server.

### Workflow

```powershell
# Admin: export secrets encrypted for the server
jseeqret export --filter "myapp:prod:*" --for server-pubkey.pem --output secrets.enc

# Transfer to server (scp, file share, or manual copy)
scp secrets.enc deploy@server:/tmp/

# Server: import the encrypted secrets
jseeqret import /tmp/secrets.enc
```

This workflow already exists using the NaCl transit encryption. The plan is to make it more ergonomic.

### Convenience Commands

```powershell
# Combined export + transfer (if server is reachable)
jseeqret push --vault server-prod --filter "myapp:prod:*"

# On the server: pull from admin's export directory
jseeqret pull --from "\\fileserver\exports\secrets.enc"
```

### File-Based Push (Windows-friendly)

For Windows environments without SSH, use a shared directory:

1. Admin exports to a shared folder: `jseeqret push --vault server-prod --via "C:\Users\bp\OneDrive\server-exports"`
2. Server watches the shared folder and auto-imports new files.
3. After successful import, the encrypted file is deleted.

This reuses the same mailbox pattern from [linked vault](../linked-vault/plan.md).

### Deliverables
- `jseeqret push` CLI command (export + transfer in one step)
- `jseeqret pull` CLI command (download + import in one step)
- File-based transport for push/pull (shared folder or cloud sync)
- Auto-import watcher for the server side

## Phase 3: Reload API Enhancements

### Goal
Make reloading more robust and observable.

### Reload Events

```javascript
import { init, on_reload } from 'jseeqret'

await init()

on_reload((changes) => {
    console.log(`Vault reloaded: ${changes.added} added, ${changes.updated} updated, ${changes.removed} removed`)
})
```

The `on_reload` callback tells the application what changed, so it can take action (e.g., reconnect to a database with a new password, invalidate caches).

### Reload Diffing

When `reload()` is called, compare the old in-memory state with the new database state to determine which secrets changed. Return a diff object:

```javascript
{
    added: ['myapp:prod:NEW_KEY'],
    updated: ['myapp:prod:DB_PASSWORD'],
    removed: ['myapp:prod:OLD_KEY'],
    unchanged: 42
}
```

### Deliverables
- `api.on_reload(callback)` event registration
- Reload diffing logic
- Tests for reload events with various change scenarios

## Phase 4: Vault Service (Future)

### Goal
An HTTP service that mediates access to the vault, enabling remote administration without shell access.

This is deferred to Phase 3 of the overall [roadmap](../feature-plans/vault-architecture-roadmap/README.md). The server vault plan focuses on what can be done without a service.

### Sketch

- `jseeqret serve` starts an HTTP server bound to localhost.
- Endpoints: `GET /secrets/:app/:env/:key`, `POST /secrets`, `PUT /secrets/:app/:env/:key`, `DELETE /secrets/:app/:env/:key`.
- Authentication via NaCl challenge-response (admin must prove possession of their private key).
- The web application connects to the vault service instead of using `api.init()` directly.

### Deliverables
- Deferred. See [vault architecture roadmap](../feature-plans/vault-architecture-roadmap/README.md) Phase 3.

## Security Considerations

1. **File watcher security**: Ensure that only the vault owner can write to `seeqrets.db`. If an attacker can write to the database file, the watcher would reload attacker-controlled data. Mitigate with NTFS ACLs (Windows) or file permissions (Linux).
2. **Import validation**: When importing encrypted secrets, verify the NaCl signature to ensure they came from a trusted sender.
3. **No plaintext in transit**: Even when using a shared folder for push/pull, secrets are NaCl-encrypted. The shared folder only ever sees ciphertext.
4. **Cleanup**: Delete encrypted export files after successful import. Don't leave ciphertext sitting in shared folders.

## Open Questions

1. **Should `api.watch()` be opt-in or default?** Recommendation: opt-in. Not all applications want automatic reloading. Some prefer explicit `reload()` calls on a schedule.
2. **Debounce interval**: 500ms works for most cases, but cloud-synced files may trigger multiple events over several seconds. Should the interval be configurable?
3. **Atomic reload**: Should `reload()` be atomic (swap entire in-memory state) or incremental (apply a diff)? Atomic is simpler and safer. Incremental is more efficient for large vaults.
