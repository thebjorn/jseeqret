# Vault-to-Vault Communication -- Security Concerns

## 1. No Forward Secrecy in NaCl Box Encryption

**Risk**: High | **Category**: Cryptographic design

The NaCl Box construction (X25519 + XSalsa20-Poly1305) uses static keypairs. If a recipient's private key is compromised at any point in the future, every previously captured encrypted export can be decrypted retroactively. This is particularly concerning because:
- Encrypted exports may persist in shared folders, cloud storage, email archives, or backup systems.
- The inbox directory accumulates encrypted files that are only moved to `.processed/` (not deleted).

**Mitigation**:
- Delete encrypted files after successful import (not just move to `.processed/`).
- For future versions, consider an ephemeral key exchange (generate a per-message X25519 keypair, include the ephemeral public key in the export, derive a shared secret from ephemeral-private + recipient-public). This provides forward secrecy.
- Document that private key compromise retroactively exposes all historical exports.

## 2. Inbox Directory as a Persistent Attack Target

**Risk**: High | **Category**: Data exposure

The inbox directory (`~/.jseeqret-inbox` or cloud-synced equivalent) accumulates encrypted export files. This directory is a high-value target because:
- It contains encrypted versions of secrets from multiple senders.
- The `.processed/` subdirectory retains already-imported files.
- On cloud sync folders, copies exist on the cloud provider's servers and in their backups.

**Mitigation**:
- Automatically delete files from `.processed/` immediately (or within hours, not days).
- The `jseeqret inbox gc` command should be documented prominently.
- Consider adding a config option to auto-purge processed files on each `receive`.
- Never store the inbox in a directory that is backed up to cloud or version-controlled.

## 3. Request Signature Verification Depends on Key Trust

**Risk**: Medium | **Category**: Authentication

The secret request protocol uses NaCl signatures to authenticate requests. Alice verifies Bob's signature using Bob's public key from her local `users` table. But how did Bob's public key get there? If the initial key exchange was over an insecure channel (email, chat), an attacker could have performed a man-in-the-middle attack, substituting their own public key for Bob's.

**Mitigation**:
- Document that the initial public key exchange is the trust root -- it must happen over a verified channel.
- Consider adding key fingerprint verification: when Alice adds Bob's key, display a short fingerprint that both parties can compare out-of-band (like Signal safety numbers).
- The `jseeqret user add` command should display the key fingerprint and prompt for confirmation.

## 4. No Replay Protection on Exports

**Risk**: Medium | **Category**: Integrity

Each export includes a `created_at` timestamp, and the plan says "import should warn if the export is older than the current value." However:
- The warning is advisory -- the import proceeds by default.
- An attacker who captures an encrypted export can replay it later to overwrite a rotated secret with the old value.
- The `--dry-run` flag helps but only if the user remembers to use it.

**Mitigation**: Imports should reject exports where the `updated_at` of any included secret is older than the local value's `updated_at`, unless `--force` is specified. Add a nonce or sequence number to exports that the receiving vault tracks.

## 5. Sender Identity Not Bound to Export

**Risk**: Medium | **Category**: Authentication

The export format includes `sender` and `sender_pubkey` fields, but the export is NaCl-encrypted with the recipient's public key, not signed by the sender. The `sender` field is self-asserted metadata. An attacker who obtains the recipient's public key (which is not secret) can create an export claiming to be from any sender.

**Mitigation**: Exports should be signed by the sender's private key in addition to being encrypted for the recipient. The recipient should verify the sender's signature against the known public key in their `users` table. Reject imports from unknown senders.

## 6. Inbox Path Discovery

**Risk**: Low | **Category**: Information disclosure

Open Question #2 asks how Alice discovers Bob's inbox path. The options (exchanged during key exchange, stored in `users` table, convention-based) all have information disclosure implications:
- Storing inbox paths in the `users` table means anyone with vault access sees everyone's inbox locations.
- Convention-based paths (`\\fileserver\inboxes\<username>`) are predictable and enumerable.

**Mitigation**: Inbox paths should be user-configurable and not follow a predictable convention. Consider using a hash-based directory name rather than the username.

## 7. Bulk Export Exposes Full Secret Sets

**Risk**: Medium | **Category**: Over-sharing

The `--filter` option on export allows patterns like `myapp:*:*` which could match more secrets than intended. A user who runs `jseeqret send --filter "*:*:*" --to bob` sends their entire vault contents to Bob.

**Mitigation**:
- The `send` and `export` commands should display the count and list of matching secrets before proceeding, requiring confirmation.
- Consider adding a `--max-secrets` flag that aborts if the filter matches more than N secrets (prevents accidental over-sharing).
- The `--dry-run` flag should be prominently documented.

## 8. Request Fulfillment Without Scope Verification

**Risk**: Medium | **Category**: Authorization

When Alice fulfills Bob's request, the plan doesn't mention checking whether Bob should have access to the requested secrets. Alice must manually judge whether the request is appropriate. In a busy environment, an attacker could send requests for secrets they shouldn't have, counting on the admin to fulfill without careful review.

**Mitigation**: The `requests fulfill` command should display full details of what will be sent and require explicit confirmation. If an ACL exists, cross-reference the request against the requester's permissions. Warn if the request is for secrets outside the requester's ACL scope.

## Summary

| #   | Concern                                 | Risk   | Action Required                                  |
| --- | --------------------------------------- | ------ | ------------------------------------------------ |
| 1   | No forward secrecy                      | High   | Delete exports after import, plan ephemeral keys |
| 2   | Inbox is a persistent target            | High   | Auto-purge processed files                       |
| 3   | Key trust depends on initial exchange   | Medium | Show key fingerprints on add                     |
| 4   | No replay protection                    | Medium | Reject stale imports by default                  |
| 5   | Sender identity not signed              | Medium | Sign exports with sender's key                   |
| 6   | Inbox path discovery                    | Low    | Avoid predictable paths                          |
| 7   | Bulk export over-sharing                | Medium | Confirm before sending, show match count         |
| 8   | Request fulfillment without scope check | Medium | Cross-reference ACL on fulfill                   |
