# Vault-to-Vault Communication

## Problem

Secrets live in vaults, but they need to move between vaults: from an admin's vault to a server, from one team member to another, from a dev vault to a staging vault. Today this requires a manual multi-step workflow. We need secure, ergonomic ways to move secrets between vaults.

## Current State

The existing workflow for sharing a secret from Alice to Bob:

1. Alice imports Bob's public key into her vault.
2. Alice exports the secrets she wants to share, encrypting them with Bob's public key (NaCl X25519 + XSalsa20-Poly1305).
3. Alice transmits the encrypted export to Bob (email, file share, API, etc.).
4. Bob imports the encrypted secrets into his vault, decrypting them with his private key and re-encrypting with his own vault key (Fernet).

This works and is cryptographically sound, but it is manual and requires coordination outside of jseeqret.

## Desired Behavior

1. **One-command sharing** -- `jseeqret send DB_PASSWORD --to bob` should handle export, encryption, and delivery in a single step.
2. **Delivery mechanism** -- secrets arrive at the recipient without requiring a separate file transfer step.
3. **Receipt confirmation** -- the sender knows when the recipient has successfully imported the secrets.
4. **Bulk sharing** -- share multiple secrets at once using filter patterns (`--filter 'myapp:prod:*'`).
5. **Revocation** -- if a shared secret is rotated or deleted, notify recipients (or automatically update via [linked vault](../linked-vault/) sync).

## Communication Models

### Model A: File-Based Exchange
Secrets are exported to an encrypted file, transmitted out-of-band, and imported by the recipient. This is the current model, with better ergonomics.

**Pros**: No new infrastructure, works offline, any transport (email, USB, shared folder).
**Cons**: Manual delivery, no receipt confirmation, no revocation.

### Model B: Shared Directory (Mailbox)
Each user has an inbox directory (local or cloud-synced). Secrets are delivered by writing to the recipient's inbox.

**Pros**: Asynchronous delivery, works with cloud sync (OneDrive, Dropbox), no service needed.
**Cons**: Requires shared filesystem or cloud sync, polling for new messages.

### Model C: Vault Service API
A vault service (HTTP) exposes endpoints for sending and receiving secrets.

**Pros**: Real-time delivery, receipt confirmation, clean API.
**Cons**: Requires running a service, network access between vaults.

## Relationship to Other Features

| Feature                            | Relationship                                                        |
| ---------------------------------- | ------------------------------------------------------------------- |
| [Server Vault](../server-vault/)   | Primary use case: admin pushes secrets to a server vault.           |
| [Linked Vault](../linked-vault/)   | Automated vault-to-vault sync for the same user's vaults.           |
| [Shared Vault](../shared-vault/)   | Alternative: instead of sending secrets, share a vault.             |
| [Sync-Merge](../sync-merge/)       | The merge algorithm used when vaults sync bidirectionally.          |
| [Multi-Vault](../multi-vault/)     | The registry provides addressable vault names for `--to` targeting. |
| [Auto-Rotation](../auto-rotation/) | Rotated secrets should propagate to recipients.                     |

## Use Cases

### UC1: Admin deploys secrets to server
Admin runs `jseeqret push --vault server-prod --filter 'myapp:prod:*'` to push all production secrets to the server vault.

### UC2: Sharing with a team member
Alice runs `jseeqret send API_KEY --app myapp --to bob`. Bob receives the secret in his inbox and imports it.

### UC3: Onboarding a new developer
Admin exports all secrets for a project: `jseeqret export --filter 'myapp:*:*' --for charlie --output onboarding.enc`. Charlie imports with `jseeqret import onboarding.enc`.

### UC4: Secret request
Bob needs a secret that Alice has. Bob creates a signed request: `jseeqret request DB_PASSWORD --app myapp --from alice`. Alice receives the request, reviews it, and fulfills it.

## Open Questions

1. **User directory**: Where does jseeqret find Bob's public key? Options: local `users` table (already exists), a key server, or exchange via file.
2. **Inbox location**: For the mailbox model, where is the inbox? Options: a directory in the vault, a shared cloud folder, or a subdirectory of the user's config dir.
3. **Secret request protocol**: How are requests signed and verified? NaCl signatures with the requester's private key?
4. **Batch vs. incremental**: Should `jseeqret send` always send the full set of matching secrets, or only changes since the last send?

## Documents

- [Implementation Plan](plan.md) -- phased approach to vault-to-vault communication
