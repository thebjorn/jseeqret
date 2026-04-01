# Vault-to-Vault Communication -- Implementation Plan

## Overview

This plan improves the existing export/import workflow with convenience commands, a mailbox delivery mechanism, and a secret request protocol. It builds on the existing NaCl transit encryption and the [multi-vault](../multi-vault/) registry.

## Phase 1: Ergonomic Export/Import

### Goal
Reduce the manual steps in the current export/import workflow.

### Convenience Commands

**Export with recipient targeting:**

```powershell
# Export specific secrets for a known user
jseeqret export --filter "myapp:prod:*" --for bob --output secrets.enc

# Export to a specific directory (auto-named with timestamp)
jseeqret export --filter "myapp:prod:*" --for bob --outdir "C:\Users\bp\OneDrive\exports"
```

**Import with validation:**

```powershell
# Import and show what was added/updated
jseeqret import secrets.enc --dry-run    # preview
jseeqret import secrets.enc              # apply
```

### Export Format

The existing export format is a JSON file containing NaCl-encrypted secret values. Enhance with metadata:

```json
{
    "version": 1,
    "sender": "alice",
    "sender_pubkey": "base64...",
    "recipient": "bob",
    "created_at": "2026-04-01T10:00:00Z",
    "secrets": [
        {
            "app": "myapp",
            "env": "prod",
            "key": "DB_PASSWORD",
            "value": "nacl-encrypted-base64...",
            "type": "str",
            "updated_at": "2026-04-01T09:30:00Z"
        }
    ]
}
```

### Deliverables
- Enhanced `jseeqret export` with `--for`, `--outdir`, auto-naming
- Enhanced `jseeqret import` with `--dry-run`, diff output
- Export format v1 with metadata envelope
- Tests for export/import roundtrip

## Phase 2: User Management

### Goal
Make it easy to manage known users (their public keys) for targeted sharing.

### Current State

The `users` table in `seeqrets.db` already stores usernames and public keys. This phase adds CLI commands to manage them.

### Commands

```powershell
# Import a user's public key from a file
jseeqret user add bob --pubkey "C:\keys\bob-public.key"

# Import from the clipboard (convenient for key exchange via chat)
jseeqret user add bob --pubkey-stdin   # paste key, Ctrl+Z to end

# List known users
jseeqret user list

# Export your own public key for sharing
jseeqret user export-key --output my-public.key

# Remove a user
jseeqret user remove bob
```

### Deliverables
- `src/cli/commands/user.js` -- user management subcommands
- Public key export command
- Tests for user CRUD

## Phase 3: Mailbox Delivery

### Goal
Deliver secrets to a recipient's inbox without manual file transfer.

### Design

Each user has an **inbox directory** -- a folder where incoming encrypted exports are deposited. The inbox can be:

| Location | Example | Use Case |
|----------|---------|----------|
| Cloud sync folder | `C:\Users\bp\OneDrive\.jseeqret-inbox` | Remote delivery via cloud sync |
| Network share | `\\fileserver\inboxes\bob` | Same-network delivery |
| Local directory | `C:\Users\bp\.jseeqret\inbox` | Manual transfer (USB, etc.) |

### Inbox Registration

The inbox path is stored in the user's registry (alongside vault entries):

```json
{
    "inbox": "C:\\Users\\bp\\OneDrive\\.jseeqret-inbox",
    "default": "work",
    "vaults": { }
}
```

### Send Command

```powershell
# Send secrets to bob's inbox (looks up bob's inbox path from local config)
jseeqret send --filter "myapp:prod:*" --to bob

# Send to a specific path (if bob's inbox isn't registered locally)
jseeqret send --filter "myapp:prod:*" --to-path "\\fileserver\inboxes\bob"
```

### Receive Command

```powershell
# Check inbox for new messages
jseeqret receive              # list pending imports
jseeqret receive --apply      # import all pending
jseeqret receive --apply --from alice   # import only from alice
```

### Inbox File Structure

```
.jseeqret-inbox/
    alice-2026-04-01T100000Z.enc    # encrypted export from alice
    alice-2026-04-01T143000Z.enc    # another export from alice
    .processed/                      # successfully imported files are moved here
        alice-2026-03-31T090000Z.enc
```

### Deliverables
- Inbox path in registry
- `jseeqret send` command (export + write to recipient's inbox)
- `jseeqret receive` command (scan inbox + import)
- Inbox management (list, cleanup processed files)
- Tests for send/receive flow

## Phase 4: Secret Request Protocol

### Goal
Let a user request specific secrets from another user.

### Workflow

1. Bob needs `DB_PASSWORD` from Alice.
2. Bob creates a signed request: `jseeqret request DB_PASSWORD --app myapp --env prod --from alice`
3. The request file is deposited in Alice's inbox.
4. Alice reviews pending requests: `jseeqret requests list`
5. Alice fulfills the request: `jseeqret requests fulfill <request-id>`
6. The secret is sent to Bob's inbox.

### Request Format

```json
{
    "version": 1,
    "type": "secret_request",
    "requester": "bob",
    "requester_pubkey": "base64...",
    "requested_from": "alice",
    "secrets": [
        { "app": "myapp", "env": "prod", "key": "DB_PASSWORD" }
    ],
    "message": "Need DB access for the new reporting feature",
    "created_at": "2026-04-01T10:00:00Z",
    "signature": "nacl-signature-base64..."
}
```

The signature is created with Bob's private key, so Alice can verify the request is authentic.

### Deliverables
- `jseeqret request` command (create and send request)
- `jseeqret requests list` command (view pending requests)
- `jseeqret requests fulfill` command (send requested secrets)
- Request signing and verification
- Tests for request/fulfill flow

## Phase 5: GUI Integration

### Goal
Send, receive, and request secrets from the Electron GUI.

### Design
- **Send panel**: Select secrets, pick a recipient, send.
- **Inbox panel**: List pending imports with preview, one-click import.
- **Request panel**: Create requests, view and fulfill incoming requests.
- **Notifications**: Badge on inbox when new messages arrive (check on app start and periodically).

### Deliverables
- IPC handlers for send, receive, request
- Svelte components for inbox, send, and request flows
- Inbox polling and notification badge

## Security Considerations

1. **All secrets are NaCl-encrypted** in transit. Even if the inbox directory is compromised, secrets cannot be read without the recipient's private key.
2. **Request signatures** prevent spoofed requests. Alice verifies Bob's signature before fulfilling.
3. **Inbox cleanup**: Processed files should be deleted or moved to `.processed/` to minimize exposure. A `jseeqret inbox gc` command can purge old processed files.
4. **No replay**: Each export includes a timestamp. Import should warn if the export is older than the current value in the vault (the user may be importing stale data).

## Open Questions

1. **Bidirectional inbox**: Should both users register each other's inbox path, or should the sender provide a return address in the export metadata?
2. **Inbox discovery**: How does Alice know Bob's inbox path? Options: exchanged during key exchange, stored in the `users` table, or a convention (e.g., `\\fileserver\inboxes\<username>`).
3. **Notification mechanism**: For cloud-synced inboxes, how does the GUI know new files arrived? File watcher on the inbox directory, or periodic polling?
