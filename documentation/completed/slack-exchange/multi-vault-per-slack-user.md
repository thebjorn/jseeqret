# Multi-Vault per Slack User

## Problem

A single human operator typically has more than one vault -- for example
a home laptop vault and a work laptop vault -- but only one Slack account.
The current slack-exchange design assumes a 1:1 mapping between a local
vault user and a Slack handle, which breaks down in this scenario.

Concretely, with one slack handle `@bjorn` and two vaults (`bjorn-home`,
`bjorn-work`), each vault has its own NaCl keypair:

- When Alice runs `jseeqret slack link bjorn` she stores exactly one
  fingerprint for her local `bjorn` row. She has picked one of his two
  pubkeys and does not know the other exists. Messages she sends can only
  be decrypted on one of Bjorn's machines.
- When Bjorn runs `jseeqret receive --via slack` on both machines, both
  poll the same Slack inbox. There is nothing in the message that says
  "this one is for the work vault, not the home vault." The wrong machine
  may try-and-fail to decrypt, or worse, locally mark it as consumed.
- `find_user_by_slack_handle` in `src/core/slack/identity.js` returns the
  first row matching a handle. Any duplicate-handle scenario is
  nondeterministic today.

The underlying modelling bug is that vault-user and Slack-handle are being
conflated. They are different things: a vault user is a *keypair identity*
scoped to a machine or location, while a Slack handle is a *routing
address* for a person. The relationship is 1-to-many.

## Target Semantics

- `jseeqret send cimonitor:dev: --to vault-work-bjorn --via slack` sends
  to the local vault user `vault-work-bjorn` (encrypting to that row's
  pubkey) using the `slack_handle` on that row as the transport address.
- `jseeqret receive --via slack` on the `vault-work-bjorn` machine picks
  up only messages tagged for `vault-work-bjorn`. The `vault-home-bjorn`
  machine ignores them.
- `jseeqret send ... --to @slack-bjorn --via slack` (leading `@` marks a
  Slack handle, not a vault username) fans out: one ciphertext per vault
  user bound to that Slack handle, one Slack post per ciphertext. This
  matches the "people vs logins" distinction and makes the common case
  ("send to Bjorn, wherever he is") ergonomic.

## Wire Format

Each posted message must carry a small plaintext header above the
ciphertext:

```
jseeqret/1  to=vault-work-bjorn  from=vault-home-bjorn
<base64 NaCl-box ciphertext>
```

- `to=<vault-username>` lets every polling vault decide whether to pick
  the message up at all. Without this, multi-device receive is impossible
  to disambiguate.
- `from=<vault-username>` tells the receiver *which* of the sender's
  pubkeys to authenticate against. The receive side has the same
  multi-vault problem in reverse: Alice at work vs Alice at home may both
  send as `@alice`.
- The protocol tag (`jseeqret/1`) makes future format changes possible
  without guessing.

**Metadata leak**: the plaintext `to=`/`from=` fields reveal vault-user
names to anyone reading the channel. If that is unacceptable, substitute
a short hash of the recipient's pubkey fingerprint -- same routing
function, opaque to outsiders. Start with plaintext for debuggability;
switch to fingerprint-tags later if the leak matters.

## Consume Semantics

Message-seen tracking must be **per-vault local bookkeeping**, never a
destructive ack against Slack itself. If `bjorn-home` reacts/archives/
deletes a message the moment it sees it, `bjorn-work` will never see it.

Each vault keeps its own table of processed Slack message IDs. A message
is "consumed" only in the sense that the local vault will not re-process
it. The same message may also be "consumed" independently by another
vault belonging to the same person -- that is by design.

## Fan-out Sending

When the sender addresses a Slack handle rather than a vault username:

1. Resolve the handle to the set of local vault users bound to it.
2. Print the resolution and require explicit confirmation. A secrets
   tool must never silently fan out:

   ```
   $ jseeqret send cimonitor:dev: --to @slack-bjorn --via slack
   Resolves @slack-bjorn -> bjorn-home (fp a1b2c), bjorn-work (fp d4e5f)
   Encrypt + post 2 messages? [y/N]
   ```

3. Encrypt once per recipient pubkey (NaCl Box is per-recipient anyway)
   and post one tagged message per recipient. Do not invent a
   multi-recipient envelope format -- it complicates receive for no
   saving on the wire.

## Addressing Rules

- `--to <vault-username>`: single recipient, exact vault-user match.
- `--to @<slack-handle>`: fan-out across all local rows with that
  `slack_handle`.
- Ambiguous forms (a bare name that happens to match both a vault
  username and a slack handle) are rejected. Explicit is better than
  surprising.

## Code-side Changes Implied

1. **`src/core/slack/identity.js`**
   - `find_user_by_slack_handle` must return *all* candidates, not the
     first match.
   - Binding (`bind_slack_handle` / `slack link`) stays per-vault-user:
     each row has its own fingerprint, verified out-of-band once.
   - Drop the implicit assumption that `slack_handle` is unique across
     the `users` table.
2. **`src/core/slack/transport.js`**
   - Add header framing (`jseeqret/1  to=...  from=...`) above the
     base64 payload.
   - Version the header now -- retrofitting a version is painful.
3. **Receive loop** (`src/cli/commands/receive.js`,
   `src/core/slack/client.js`)
   - Filter inbound messages by `to=<this vault's username>` before
     attempting decrypt.
   - Track processed Slack message IDs per vault in a local table
     (migration required).
4. **Send CLI** (`src/cli/commands/send.js`)
   - Accept both addressing forms. Implement fan-out with an explicit
     confirmation prompt.
5. **Schema**
   - No column changes required; add an index on `slack_handle` because
     lookups become 1-to-many.
   - Add a per-vault `slack_seen` table keyed by (channel, message_id).

## Non-goals / Rejected Alternatives

- **Auto-resolving ambiguous `--to bjorn`** to "whichever bjorn": no.
  Addressing in a secrets tool must be unambiguous. Require explicit
  vault-user or `@handle` syntax.
- **Skipping `from=` because `to=` seems sufficient**: no. The sender
  side has the same multi-vault-per-human problem as the receiver. The
  protocol must be symmetric from day one.
- **Shared keypair across a person's vaults**: functionally works, but
  defeats the purpose of separate vaults (compromise of one machine
  compromises all of them). Not a substitute for this design.
- **Multi-recipient envelope (one ciphertext for N recipients)**: NaCl
  Box is pairwise; there is no free lunch here, and single-recipient
  messages keep receive logic trivial.

## Open Questions

- Do we want to support addressing a Slack handle that is not yet bound
  to any local vault user (i.e. "send to this human, I trust the first
  fingerprint I see")? Current answer: **no** -- `require_verified_binding`
  stays as the gate. Introduction must precede send.
- Should the fan-out confirmation be suppressible via a flag for
  scripted use? Probably yes, but only with an explicit
  `--fanout-confirmed` that the operator sets deliberately.
- Retention: per-vault `slack_seen` tables grow forever. Add a bounded
  retention policy (e.g. keep last N days of message IDs).
