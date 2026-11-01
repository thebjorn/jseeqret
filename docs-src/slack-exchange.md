---
title: Slack Exchange
---

# Slack Exchange

The `slack` transport lets two vault users trade secrets over a Slack
workspace without Slack (or its admins) ever seeing plaintext. The
mechanism layers NaCl asymmetric encryption on top of a regular Slack
file upload.

## Threat model in one paragraph

Slack is treated as **an untrusted courier**. Blobs are sealed with
the recipient's NaCl public key before upload, so neither Slack nor
anybody with workspace-admin access can read them. Size-bucket
padding (`core/slack/padding.js`) prevents trivial traffic analysis by
quantizing every ciphertext to one of a small set of fixed sizes.
Sender identity is bound to a Slack handle via a fingerprint
confirmation ritual in `slack link`, so a Slack-admin impersonation
attack surfaces as a fingerprint mismatch at decrypt time.

## Components

| file                          | role                                       |
|-------------------------------|--------------------------------------------|
| `core/slack/oauth.js`         | OAuth v2 PKCE loopback flow for `login`    |
| `core/slack/client.js`        | Thin wrapper over `@slack/web-api`         |
| `core/slack/config.js`        | Fernet-wrapped Slack config in SQLite KV   |
| `core/slack/identity.js`      | Slack-handle to user/pubkey binding        |
| `core/slack/padding.js`       | Size-bucket padding for ciphertext blobs   |
| `core/slack/transport.js`     | `send_blob` / `poll_inbox` / `delete_thread` |
| `core/slack/receive.js`       | Download, verify and import received blobs |
| `core/slack/session.js`       | Fail-closed preflight before `send`        |
| `core/slack/selftest.js`      | Live round-trip for `slack doctor --transport` |

The CLI surface lives in `src/cli/commands/slack.js` plus `send.js`
and `receive.js`.

## End-to-end flow

1. **Login** — `jseeqret slack login` runs an OAuth PKCE flow against
   your workspace, stores the access token Fernet-encrypted in the
   vault's KV table, and prompts you to pick an exchange channel.

2. **Bind** — both participants run `jseeqret slack link <local-user>
   --handle <slack-handle>`. This associates a Slack handle with a
   specific NaCl public key in the vault. The binding ritual requires
   confirming the counterparty's fingerprint aloud on a voice call.

3. **Send** — `jseeqret send 'myapp:prod:*' --to bob --via slack`:
   - Fetches the matching secrets.
   - Serializes and NaCl-seals them for Bob's public key.
   - Pads the ciphertext to the next size bucket.
   - Uploads to the configured channel and posts a short inbox thread.

4. **Receive** — `jseeqret receive --via slack [--watch]` polls the
   channel for new inbox threads addressed to the current user,
   downloads the blob, unpads, decrypts with the local private key,
   and imports the resulting secrets. `--watch` turns this into a
   long-running poll loop. If a received secret conflicts with a
   different local value, `receive` fails closed; `--strategy
   mine|theirs|newer` decides instead.

5. **Doctor** — `jseeqret slack doctor` is the health check. It
   verifies the token and channel, fails if the workspace SSO + MFA
   attestation is missing or older than 90 days, checks that linked
   users were verified in the last 180 days and that their stored
   fingerprints still match, and fails if the list of connected
   workspace apps differs from the recorded baseline, so a rogue app
   added by an admin cannot pass silently. `--accept` records the MFA
   attestation and re-baselines the connected apps after a legitimate
   change. `--transport` runs a live self-test: it sends an envelope to
   yourself, checks that the poller finds it, and deletes it.

   Before `send --via slack`, jseeqret checks that you are logged in,
   a channel is set, the token is at most 90 days old and the MFA
   attestation is current.

## Design decisions

- **Why Slack?** Because teams who need to share secrets usually
  already have Slack. Re-using an existing identity provider beats
  running our own relay.
- **Why not Slack's e2ee?** Slack's native file sharing isn't end-to-end
  encrypted. We don't trust the channel — we trust the NaCl
  box around the bytes we hand to the channel.
- **Why size-bucket padding?** A plaintext `.env` for "myapp-prod"
  versus "myapp-dev" would leak through distinct ciphertext sizes.
  Bucketing removes that signal.
