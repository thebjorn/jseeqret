# Slack Channel Exchange -- Security Concerns

The premise of this idea is that a private Slack channel is *at least as
secure as* a shared cloud-sync mailbox (OneDrive, Dropbox) and *much less
work* than running a vault service. This review tests that premise.

The payload is always the existing NaCl-encrypted export blob. Slack only
ever sees ciphertext. The concerns below are therefore about *metadata*,
*transport trust*, *identity binding* and *operational hygiene* -- not
about Slack breaking the crypto.

## 1. Third-Party Custodian of Ciphertext

**Risk**: Medium | **Category**: Data custody

Slack Technologies (Salesforce) stores every message and file upload on
their infrastructure, subject to their retention policies, their backups,
their subpoena responses, and their breach history. The same is true of
OneDrive/Dropbox for the mailbox model, so this is not *worse* than the
baseline, but it is not *invisible* either.

**Mitigation**:
- Keep forward secrecy as an explicit goal: rotate vault keys if a channel
  is ever retroactively exposed (see concern #2 of the vault-to-vault
  review).
- Document that Slack (and any cloud mailbox) holds indefinitely-retrievable
  ciphertext unless a retention policy is configured.
- Prefer workspaces with a short (7-day) message retention policy for
  exchange channels.
- Never post plaintext secrets to the channel under any circumstances --
  enforce this by making `jseeqret send --via slack` refuse to attach a
  file that is not already NaCl-encrypted.

## 2. Metadata Leakage to the Workspace

**Risk**: Medium | **Category**: Information disclosure

Even though file contents are ciphertext, Slack exposes a rich set of
metadata to every channel member (and to Slack itself):

- Sender and recipient handles.
- Filenames (`api_key.jsenc`, `prod_db_password.jsenc`).
- Timestamps and frequency ("Alice rotates the DB password every Friday").
- File sizes, which correlate with secret count.
- Reactions and thread replies ("imported ✅").

Workspace admins can read everything in a private channel via Discovery
APIs. A compromised workspace owner or a misconfigured DLP integration can
exfiltrate the full audit trail.

**Mitigation**:
- Use opaque filenames (`jsenc-<random-id>.bin`) rather than anything that
  names the secret.
- Do not put `app:env:key` paths in the Slack message text. Keep the
  recipient handle, nothing else.
- Document that workspace admins can see channel history; the channel
  should live in a workspace whose admins you already trust with secrets.
- Consider padding exports to a fixed size bucket to defeat file-size
  correlation.

## 3. Bot Token as a High-Value Secret

**Risk**: High | **Category**: Key management

The Slack bot token gives whoever holds it the ability to read every
ciphertext ever posted to the exchange channel. That makes it roughly as
sensitive as a vault's `private.key`: with the bot token plus a single
user's private key, an attacker unlocks every secret that user has ever
received. Storing it in the vault is circular but unavoidable.

**Mitigation**:
- Use a **read-scoped bot** for receivers (`channels:history`, `files:read`)
  and a **write-scoped bot** for senders (`chat:write`, `files:write`). Do
  not hand out one omnipotent token.
- Prefer User tokens over Bot tokens where the workspace policy permits,
  so Slack's own audit log attributes actions to a human.
- Rotate the token on a schedule and on every team membership change.
- Store the token in the vault itself (inside Fernet) so it gains the same
  at-rest protection as everything else. Bootstrap it via an interactive
  `jseeqret slack login` that calls the Slack OAuth flow.

## 4. Identity Binding Between Slack Handle and NaCl Public Key

**Risk**: High | **Category**: Authentication

"`--to @bob`" is convenient, but the Slack handle does not *prove* which
NaCl public key should encrypt the message. If the mapping is stored in
the local `users` table, then the attack reduces to the existing
"initial key exchange is the trust root" problem (vault-to-vault concern
#3). If the mapping is stored in Slack itself (e.g. in Bob's profile or a
pinned message), then **whoever controls Bob's Slack account can swap the
public key and silently redirect future exports to an attacker**.

This is worse than the OneDrive mailbox model, where the filesystem has
no notion of profile fields that can be rewritten.

**Mitigation**:
- Never trust a public key fetched from a Slack profile/pin without a
  local fingerprint check.
- `jseeqret user add @bob` must display the key fingerprint and require
  the operator to confirm it out-of-band (voice, in-person, a second
  channel).
- Cache the confirmed fingerprint in the local `users` table. If Slack
  ever advertises a different key for `@bob`, refuse to send and warn.
- Sign exports with the sender's private key (already a vault-to-vault
  concern #5) so Bob can detect a swapped sender as well.

## 5. Slack Account Takeover = Inbox Takeover

**Risk**: High | **Category**: Account security

A compromised Slack account with access to the exchange channel can:

- Read every ciphertext (harmless without the recipient's private key,
  but useful for a retroactive decryption attack later).
- Post forged exports claiming to be from any sender (mitigated if exports
  are signed).
- Delete messages to hide tracks.
- Rewrite their own profile-advertised public key (see concern #4).

Slack accounts are typically protected by SSO and, hopefully, MFA, but
they are *not* hardware-backed, and SSO phishing is a well-trodden path.

**Mitigation**:
- Enforce SSO + hardware MFA at the workspace level -- this is a
  prerequisite for using Slack as an exchange, not an optional hardening.
- The vault must reject imports that are not signed by a known sender
  key, so "send from any account" alone is not enough to inject a secret.
- Add anomaly heuristics: warn if a sender posts more than N exports per
  hour, or posts from a new Slack client.

## 6. Message Retention vs. Forward Secrecy

**Risk**: Medium | **Category**: Cryptographic hygiene

NaCl Box has no forward secrecy (vault-to-vault concern #1). Slack's
default retention is *indefinite*. The combination means an attacker who
compromises Bob's `private.key` a year from now can walk back through the
entire channel history and decrypt every secret ever sent to Bob -- in a
neatly timestamped, fully indexed archive.

A OneDrive mailbox has the same problem, but cloud folders are easier to
configure with a "delete after N days" policy. Slack retention is
workspace-wide and often administratively sticky.

**Mitigation**:
- Enforce a short per-channel retention policy (≤7 days) on the exchange
  channel.
- `jseeqret receive` should issue `files.delete` / `chat.delete` after
  a successful import (requires `files:write`, `chat:write`).
- Document "rotate on private.key exposure" as the required response --
  there is no way to make captured ciphertext uncaptured.

## 7. DLP, Backups and Connected Apps

**Risk**: Medium | **Category**: Unexpected data flow

Slack workspaces routinely have third-party apps connected: DLP scanners,
compliance archivers, e-discovery exporters, analytics bots. Many of these
request `files:read` and quietly mirror every file upload into *another*
cloud. A ciphertext mirrored into a DLP vendor is still ciphertext, but
it widens the ciphertext custody perimeter and multiplies the retroactive-
decryption risk.

**Mitigation**:
- Audit the connected apps on the workspace before using it as an
  exchange. Avoid any archiver that retains files.
- Put the exchange channel in a workspace where connected-app installs
  are admin-gated.
- This is an operational concern that must be re-checked periodically.

## 8. Rate Limits and Availability

**Risk**: Low | **Category**: Availability

Slack rate-limits bot API calls. A `jseeqret receive` loop or a bulk
admin push can get throttled, delayed, or (in worst cases) temporarily
suspended. The channel can also be deleted by a workspace admin. None of
this breaks confidentiality, but it means the exchange must tolerate
outages gracefully.

**Mitigation**:
- `receive` should fail closed (do not report success if Slack API is
  unreachable) and should back off on 429s.
- Treat Slack as a *transport*, not as *storage of record*: the vault is
  still the source of truth.

## 9. Legal / Discovery Exposure

**Risk**: Low | **Category**: Compliance

Slack messages are routinely produced in litigation and regulatory
discovery. Ciphertext is arguably not responsive to most requests, but
the *metadata* (who sent what to whom, when) almost certainly is, and
once jseeqret file uploads are in a discovery set they are harder to
scrub.

**Mitigation**:
- Document this for administrators; defer to the workspace's legal
  retention policy.
- Prefer a dedicated workspace for exchange where legal holds are scoped
  narrowly.

## Summary

| #   | Concern                                  | Risk   | Action Required                                    |
| --- | ---------------------------------------- | ------ | -------------------------------------------------- |
| 1   | Third-party ciphertext custody           | Medium | Short retention, document custody perimeter       |
| 2   | Metadata leakage                         | Medium | Opaque filenames, pad sizes, trust workspace admins|
| 3   | Bot token is high-value                  | High   | Split read/write tokens, rotate, store in vault    |
| 4   | Slack handle → pubkey binding            | High   | Fingerprint confirmation, pin in local users table |
| 5   | Slack account takeover                   | High   | Enforce SSO+MFA, require signed exports            |
| 6   | Retention vs. forward secrecy            | Medium | ≤7d retention, delete-on-import                    |
| 7   | DLP / connected-app mirroring            | Medium | Audit connected apps, restrict workspace           |
| 8   | Rate limits / availability               | Low    | Fail closed, backoff                               |
| 9   | Legal discovery of metadata              | Low    | Document, scope workspace narrowly                 |

## Verdict

The idea holds up: **a private Slack channel is a defensible transport if
and only if the operator already trusts the workspace's admins and SSO
posture as much as they trust their secrets**. It is roughly equivalent to
a cloud-synced mailbox for confidentiality, slightly better for audit, and
slightly worse for identity binding (because Slack profiles are mutable).

It is emphatically **not** a substitute for the existing NaCl Box envelope
-- Slack must only ever see ciphertext -- and it inherits every
vault-to-vault concern on top of its own.

The biggest net-new risk is #4 (handle → pubkey binding). The biggest
operational trap is #6 (indefinite retention silently erodes forward
secrecy). Everything else is manageable with the mitigations above.
