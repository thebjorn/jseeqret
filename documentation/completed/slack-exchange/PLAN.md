# Slack Exchange Implementation Plan

## Context

jseeqret today supports exchanging NaCl-encrypted secret exports only via
file/stdout (`jseeqret export`) and file-based import (`jseeqret load`). The
`index.md` idea proposes using a private Slack channel as the transport so
small teams can exchange ciphertext blobs with zero infrastructure.
`security-concerns.md` catalogs the threats; this plan treats those
concerns as hard requirements, not suggestions.

The feature lands in the existing three-layer design:

- Core library (`src/core/slack/`) -- transport primitives, no CLI coupling
- CLI (`src/cli/commands/slack.js`, `send.js`, `receive.js`) -- user-facing
- Electron GUI -- deferred to a follow-up; no UI code in this plan

Test team: `ntseeqrets`. Test channel: `#seeqrets` (private).

## Guiding Principles (mapped to security-concerns.md)

| # | Concern                            | Enforcement in this plan                                                                                                   |
| - | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1 | Third-party ciphertext custody     | `send` refuses non-ciphertext; retention documented; delete-on-import                                                      |
| 2 | Metadata leakage                   | Opaque filename `jsenc-<uuid>.bin`; size padding to a 4 KiB bucket; thread text is only `<@U...>`                          |
| 3 | Bot token = high-value secret      | **User tokens via OAuth** (not bot tokens); stored Fernet-encrypted inside vault under `kv` key `slack.user_token`         |
| 4 | Handle to pubkey binding           | `slack link` requires manual fingerprint confirmation; fingerprint cached in `users` row; mismatch = hard refuse           |
| 5 | Account takeover = inbox takeover  | All exports are NaCl-Box (sender-authenticated); `receive` rejects blobs whose sender pubkey is not locally known          |
| 6 | Retention vs forward secrecy       | `receive` deletes Slack message + file after successful import; `slack doctor` fails if channel retention > 24 h           |
| 7 | DLP / connected-app mirroring      | `slack doctor` hashes the connected-app list and requires operator acknowledgement on drift                                |
| 8 | Rate limits / availability         | Backoff on 429; `receive` fails closed (non-zero exit, no state mutation) on any API error                                 |
| 9 | Legal discovery of metadata        | Documented in the per-team setup section                                                                                   |

## Critical Files

### New (core)

- `src/core/slack/client.js` -- thin wrapper around Slack Web API:
  `auth_test`, `files_upload_v2`, `files_delete`, `conversations_history`,
  `conversations_replies`, `chat_postMessage`, `chat_delete`,
  `users_lookupByEmail`, `apps_connections_list`. Backoff on 429. No
  globals -- every call takes an injected token.
- `src/core/slack/transport.js` -- `send_blob(ciphertext, recipient)`,
  `poll_inbox(since_ts)`, `delete_message(ts, file_id)`.
- `src/core/slack/identity.js` -- fingerprint-verified pubkey to
  slack_handle mapping; reads/writes new columns on the `users` table.
- `src/core/slack/config.js` -- channel_id, last_seen_ts, OAuth tokens,
  all Fernet-wrapped via existing `crypto/fernet.js`.
- `src/core/slack/oauth.js` -- OAuth v2 PKCE flow with loopback redirect on
  `http://127.0.0.1:<ephemeral>/callback`.
- `src/core/slack/padding.js` -- 4 KiB bucket padding with a 4-byte length
  prefix so `receive` can strip it.

### New (CLI)

- `src/cli/commands/slack.js` -- `slack login`, `slack logout`,
  `slack link <handle>`, `slack doctor [--accept]`, `slack status`.
- `src/cli/commands/send.js` -- `send <filter>... --to <user> [--via slack|file]`;
  `--via file` is a thin alias for the existing `export` command.
- `src/cli/commands/receive.js` -- `receive [--via slack] [--watch] [--interval <s>]`.

### Modified

- `src/cli/index.js` -- register the new commands.
- `src/core/migrations.js` -- migration adding the columns below and a new
  `kv` table.
- `package.json` -- add `@slack/web-api` (no Socket Mode package).

### Reused (do NOT reimplement)

- `src/core/crypto/nacl.js` -- `asymmetric_encrypt`, `asymmetric_decrypt`,
  `fingerprint`.
- `src/core/crypto/fernet.js` -- wraps Slack tokens and channel config at
  rest.
- `src/core/serializers/json-crypt.js` -- existing export payload, untouched.
- `src/cli/commands/export.js` / `load.js` -- the ciphertext pipeline the
  Slack transport wraps.

## Data Model Changes

Migration `NNN_slack_exchange.sql`:

```sql
ALTER TABLE users ADD COLUMN slack_handle TEXT;
ALTER TABLE users ADD COLUMN slack_key_fingerprint TEXT;
ALTER TABLE users ADD COLUMN slack_verified_at INTEGER;

CREATE TABLE IF NOT EXISTS kv (
    key             TEXT PRIMARY KEY,
    encrypted_value BLOB NOT NULL,
    updated_at      INTEGER NOT NULL
);
```

`kv` keys used by this feature (all values Fernet-encrypted):

- `slack.user_token`         -- `xoxp-...` OAuth user token
- `slack.team_id`
- `slack.team_name`
- `slack.channel_id`
- `slack.channel_name`       -- e.g. `seeqrets`
- `slack.last_seen_ts`       -- ts of the last successfully imported blob
- `slack.connected_apps_hash` -- baseline hash for `slack doctor`

## Wire Protocol

Each `send` produces exactly one `files.uploadV2` call plus one thread
reply:

1. **File upload**
   - `filename`: `jsenc-<uuid4>.bin`
   - `title`: empty string
   - `content`: ciphertext bytes, padded with random bytes to the nearest
     4 KiB bucket (the first 4 bytes encode the real length so `receive`
     can strip the padding)
   - `channels`: configured channel_id
2. **Thread reply on the file's share message**
   - Body: `<@U_BOB>` -- exactly the recipient user ID, nothing else
   - No filenames, no `app:env:key`, no sender commentary

`receive` walks `conversations.history` forward from `last_seen_ts`, and
for each file-share message:

1. Fetch the thread, find the mention that matches `self.user_id`
2. Download the file via `files.info` (private URL, Bearer auth)
3. Strip padding, `asymmetric_decrypt` with local `private.key` against the
   sender's known NaCl pubkey (resolved via `users.slack_handle` -> pubkey)
4. On success: `storage.add_secret` for each entry, then `files.delete` +
   `chat.delete` on the thread reply
5. Advance `last_seen_ts` only after the deletes return OK
6. On any failure (decrypt, unknown sender, rate-limit): fail closed -- do
   NOT advance `last_seen_ts`, exit non-zero

## CLI Surface

```
jseeqret slack login                            # OAuth, stores user token + team info
jseeqret slack logout                           # wipes kv slack.* entries
jseeqret slack link <handle>                    # binds slack handle to a local user by fingerprint
jseeqret slack doctor [--accept]                # retention + connected-apps + scope audit
jseeqret slack status                           # team, channel, last_seen_ts, token age

jseeqret send <filter>... --to <user> --via slack
jseeqret receive --via slack [--watch] [--interval <s>]
```

`send --via file` is a thin alias for the existing `export` command so
users have one verb regardless of transport.

## OAuth and Identity Flow

### `jseeqret slack login`

1. Spawn loopback HTTP server on `127.0.0.1:<ephemeral>`
2. Open `https://slack.com/oauth/v2/authorize?...&redirect_uri=...&code_challenge=...`
3. Slack redirects back with `code`; exchange for a user token (PKCE)
4. `auth.test` -> write `team_id`, `team_name`, `user_id`
5. List private channels the authenticated user is a member of; prompt to
   pick one (default: `seeqrets`); write `channel_id` + `channel_name`
6. Persist everything Fernet-encrypted in the `kv` table

### `jseeqret slack link <handle>`

1. Look up `<handle>` in the local `users` table (must already exist via
   `jseeqret add user`)
2. Resolve the Slack `user_id` for `@handle` via `users.lookupByEmail`
   (falls back to `users.list`)
3. Print the **local** pubkey fingerprint:
   `Local pubkey fingerprint: ab12c`
4. Prompt:
   `Type "ab12c" to confirm you have verified this fingerprint with
   <handle> out-of-band (voice/in-person):`
5. On confirm, write `slack_handle`, `slack_key_fingerprint`, and
   `slack_verified_at` on the users row
6. On later `send --via slack --to <handle>`: recompute fingerprint and
   refuse if it no longer matches the stored one

Public keys are never fetched from Slack profiles or pinned messages.
This puts concern #4 entirely out of reach of a Slack account attacker.

## Setup Instructions

### For whoever maintains jseeqret (one-time)

jseeqret ships with a pre-registered Slack app; the Client ID is baked
into the CLI. End users never create a Slack app themselves. The maintainer
steps:

1. https://api.slack.com/apps -> Create New App -> From scratch. Name it
   `jseeqret`.
2. Distribution -> Public Distribution -> enable.
3. **OAuth & Permissions** -> add **User Token Scopes** (not Bot scopes):

   - `channels:history`      -- read private channel messages
   - `channels:read`         -- list private channels during `slack login`
   - `files:read`            -- download ciphertext files
   - `files:write`           -- upload and delete ciphertext files
   - `chat:write`            -- post the thread mention
   - `chat:write:user`       -- delete own thread messages on receive
   - `users:read`            -- resolve `@handle` to user_id
   - `users:read.email`      -- resolve by email during `slack link`

4. **Redirect URLs** -> add `http://127.0.0.1/callback`. Slack allows
   loopback with any port when the host is `127.0.0.1`.
5. **App-Level Tokens** -- none. We are not using Socket Mode.
6. Bake the Client ID into the CLI build. The Client Secret is used only
   inside the PKCE User-token flow and is not security-critical, but do
   not paste it in public logs.

### For each team admin (one-time per team)

1. **Create the team**: the test team is `ntseeqrets`.
2. **Enforce SSO and hardware MFA** at the workspace level. This is a
   prerequisite, not a recommendation (concern #5).
3. **Create the private channel**: `#seeqrets`. Add every team member
   who will send or receive.
4. **Set channel retention** on `#seeqrets` to **24 hours** (or your
   workspace's minimum). `slack doctor` will refuse to let you use
   anything longer (concern #6).
5. **Audit connected apps**: Workspace Settings -> Connected Apps. If any
   DLP / archiver / e-discovery app has `files:read`, either remove it or
   choose a different workspace for the exchange (concern #7). Document
   what you found.
6. **Scope the workspace narrowly**: legal holds and discovery exposure
   are lower in a workspace dedicated to this purpose (concern #9).

### For each user (one-time per vault)

```bash
jseeqret slack login             # opens browser, finishes in ~10s
jseeqret slack doctor            # must be all-green before the first send
jseeqret slack link alice        # confirm fingerprint on a voice call
jseeqret slack link carol        # ...
```

### Ongoing hygiene (`slack doctor`)

`slack doctor` runs the following checks and exits non-zero if any fail.
`send` and `receive` refuse to run while doctor is in a fail state.

- `[x] user token present and not older than 90 days`
- `[x] channel retention <= 24 h`
- `[x] no archiver / DLP app has files:read`
- `[x] connected-app list unchanged since last accepted baseline`
  (on first change, warn once and require `slack doctor --accept` to
  re-baseline; on subsequent changes, hard-fail)
- `[x] every linked user has a fingerprint verified in the last 180 days`
- `[x] SSO + hardware MFA on workspace (manual attestation by admin,
       reprompted every 90 days)`

## Build Sequence

1. **Migration + `kv` infrastructure** -- extend `SqliteStorage` with
   `kv_get`/`kv_set`/`kv_delete`; add Fernet wrap/unwrap helpers in
   `src/core/slack/config.js`. Unit tests for round-trip.
2. **Slack client wrapper** (`src/core/slack/client.js`) with injected
   token, 429 backoff, and deterministic error shapes.
3. **OAuth loopback** (`src/core/slack/oauth.js`) + `slack login` command.
   Manual test against `ntseeqrets`.
4. **Identity binding** (`src/core/slack/identity.js`) + `slack link`.
   Unit tests for correct and rejected fingerprints.
5. **Transport** (`src/core/slack/transport.js`): `send_blob`,
   `poll_inbox`. No CLI yet; exercised with a mock client.
6. **Padding** (`src/core/slack/padding.js`): 4 KiB buckets, length prefix,
   round-trip tests.
7. **`send` and `receive` commands** -- wire transport into the existing
   export/load pipeline; delete-on-import; `last_seen_ts` bookkeeping.
8. **`slack doctor`** -- every check above.
9. **End-to-end test** against `ntseeqrets` / `#seeqrets`: alice to bob,
   retention check, deliberately-corrupted blob to confirm fail-closed
   behaviour.
10. **Docs**: user guide (this file), README section, any new entries in
    `tasks/lessons.md`.

## Resolved Decisions

- **Slack app credentials** are baked into the jseeqret binary. Per-team
  admins never create their own Slack app.
- **`receive --watch`** uses HTTP polling only in the MVP. Default
  interval 30 s, overridable via `--interval`. No Socket Mode, no
  app-level token.
- **`slack doctor`** on connected-app drift: warn once on first change
  and require `slack doctor --accept` to re-baseline; hard-fail on any
  subsequent change until re-accepted. `send` / `receive` refuse to run
  while in fail state.
- **Sender authentication**: rely on NaCl Box's built-in authentication.
  No detached Ed25519 signature, no new keypair type. `receive` fails
  closed on any unknown-sender or decryption failure.

## Verification

End-to-end, against the real `ntseeqrets` workspace:

1. `pnpm test` -- new unit tests for transport (mocked client), identity
   binding, `kv` round-trip, padding/unpadding.
2. On a second dev vault (Bob):
   - `jseeqret slack login` -> OAuth succeeds
   - `jseeqret slack doctor` -> all green
   - `jseeqret slack link alice` with a WRONG confirmation string -> refused
   - `jseeqret slack link alice` with the correct fingerprint -> stored
3. Alice: `jseeqret send '*:*:test_key' --to bob --via slack`
   - Inspect `#seeqrets` in a browser: filename is `jsenc-<uuid>.bin`,
     thread text is only `<@U...>`
4. Bob: `jseeqret receive --via slack`
   - Secret lands in Bob's vault
   - Slack file + thread reply are gone from the channel
   - `last_seen_ts` has advanced
5. Bob: replay `receive` -> no-op (idempotent)
6. Alice sends a blob, Bob tampers with the bytes on disk ->
   `receive` must exit non-zero and not mutate the vault
7. Rotate Alice's Slack token (log out, log in) -> old `last_seen_ts`
   survives and no blobs are re-imported
8. Deliberately raise channel retention above 24 h -> `slack doctor`
   fails, `send` refuses until retention is lowered again
9. Install a harmless app in the workspace -> `slack doctor` warns once;
   run again without `--accept` -> hard-fails
