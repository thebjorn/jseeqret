# jseeqret Admin Guide

This guide is for the person who sets up jseeqret for a team. Your job
is to create a secure perimeter (Slack workspace + channel + retention
policy), then onboard each teammate so they can exchange secrets safely.

If you are instead trying to use an already-provisioned setup, read
[`end-user.md`](end-user.md) instead.

## What you are building

jseeqret stores each teammate's secrets in a local SQLite vault. When
Alice needs to give Bob a secret, Alice's vault encrypts it with Bob's
public key (NaCl Box), posts the ciphertext as a file in a private
Slack channel, and mentions Bob in a thread reply. Bob's vault polls
the channel, decrypts the file locally, imports the secret, and deletes
the message.

**Slack is the pipe, not the vault.** Slack only ever sees ciphertext.
An attacker who compromises Slack (or the workspace admin account) can
see metadata and delete messages, but cannot read any secret -- unless
they also hold a recipient's local NaCl private key.

Read [`../slack-exchange/security-concerns.md`](../slack-exchange/security-concerns.md)
before you start. The nine concerns there drive every decision in this
guide. You do not need to memorize them, but you should know which ones
the `slack doctor` command enforces, because that is what your users
will run.

## Prerequisites

- A Slack workspace you (or a workspace admin you trust) control. A
  dedicated workspace for secret exchange is strongly preferred over
  reusing an existing team workspace.
- SSO + hardware MFA enforced at the workspace level. This is a
  **prerequisite**, not a hardening step. Without it, a phished Slack
  account can post forged ciphertext blobs at will.
- Node.js 18 or newer on every client machine.
- jseeqret installed on every client machine (`pnpm install -g jseeqret`
  or via the Electron installer).

## 1. Provision the Slack workspace

1. **Create or choose a workspace.** For testing we use a workspace
   called `ntseeqrets`. In production, prefer a dedicated workspace
   with a narrow member list.
2. **Enforce SSO + hardware MFA** on every account that will access
   the exchange channel. Workspace -> Settings -> Authentication.
3. **Create a private channel** called `#seeqrets` and add every
   teammate who will send or receive secrets. Nobody outside this
   channel should be in it; nobody outside the exchange workflow
   should be in the channel.
4. **Set channel message retention to 24 hours.** In a paid workspace:
   channel settings -> "Edit message retention for this channel" ->
   "Retain all messages for 24 hours, then delete". This is what
   stops forward-secrecy decay (security concern #6). `slack doctor`
   will fail closed if retention is longer than 24 h.
5. **Audit connected apps.** Workspace -> Settings -> Manage apps.
   Any third-party app with `files:read` on this workspace is
   effectively a shadow archive of your ciphertext. Remove anything
   you do not need. If you cannot remove them, use a different
   workspace.
6. **Lock down app installation.** Restrict workspace-app installs
   to admins only, so a teammate cannot accidentally re-introduce
   an archiver.

## 2. Create the vault

On your own machine:

```bash
jseeqret init ~/.seeqrets
```

This creates, inside the vault directory:

- `seeqrets.db`  -- the SQLite vault (schema v3 or newer has the slack tables)
- `public.key`   -- your NaCl public key (safe to share)
- `private.key`  -- your NaCl private key (**never share this**)
- `seeqret.key`  -- the Fernet symmetric key used for at-rest
                    encryption of vault contents, including Slack tokens

Back up `private.key` and `seeqret.key` somewhere safe and offline
(hardware keystore, air-gapped USB, sealed envelope in a safe). If
these files are lost, every secret in the vault is unrecoverable.

## 3. Log in to Slack

```bash
jseeqret slack login
```

This opens a browser tab, walks you through the standard Slack OAuth
consent screen, and stores the resulting user token Fernet-encrypted
inside the vault's `kv` table. The token never lands on disk in
plaintext.

The flow runs on a one-shot loopback HTTP server on `127.0.0.1:<port>`
with PKCE code verification. It does not require a public callback
URL. You do not need to configure anything on Slack's side -- the
jseeqret app is pre-registered.

After the browser flow completes, the CLI prompts you to pick the
exchange channel. Choose `#seeqrets`. The channel ID and name are
persisted Fernet-encrypted.

## 4. Run doctor and accept baselines

```bash
jseeqret slack doctor --accept
```

On the first run, `--accept` stamps three baselines:

- **MFA attestation** -- you confirm that the workspace enforces SSO
  and hardware MFA. This is an operator promise, not a machine check;
  the CLI re-prompts every 90 days.
- **Connected-apps hash** -- jseeqret records a hash of the current
  set of installed workspace apps. On later runs, any drift will
  warn once and then hard-fail until you re-run `--accept`.
- **Token age** -- the token you just minted is considered fresh.

Without `--accept`, `slack doctor` reports these as failing, which is
intentional: you must explicitly acknowledge the workspace state
before `send` or `receive` are allowed to run.

Run `jseeqret slack doctor` (without `--accept`) and make sure it
is all-green before proceeding.

## 5. Add each teammate as a local user

For each teammate Bob who will receive secrets:

1. Ask Bob to run `jseeqret init` on their machine and send you
   his `public.key` file (over any channel -- it is not secret).
2. Add Bob to your vault:
   ```bash
   jseeqret add user --username bob --email bob@example.com \
       --pubkey "$(cat bob.pub)"
   ```
3. **Verify the fingerprint out-of-band.** Call Bob on a voice line
   you trust (or meet in person) and read aloud the five-character
   fingerprint of his public key. jseeqret will print it during the
   next step:
4. Link Bob's local record to his Slack handle:
   ```bash
   jseeqret slack link bob --handle bob_slack
   ```
   The CLI prints the fingerprint and asks you to type it back
   verbatim. **Only type the fingerprint if you have verified it
   with Bob in person or on a voice call you trust.** Never accept
   a fingerprint that came to you over Slack, email, or any channel
   that could be tampered with, because that is exactly the attack
   the fingerprint is meant to defeat.

Repeat for every teammate. The same rules apply to you: every
teammate should also perform this verification dance against your
public key before they send you secrets.

## 6. Ongoing hygiene

`slack doctor` is the operational backbone. Run it weekly, or before
any sensitive send:

```bash
jseeqret slack doctor
```

It enforces:

| Check                                          | What it prevents                  |
| ---------------------------------------------- | --------------------------------- |
| logged in                                      | silent failure of `send`          |
| token age <= 90 days                           | stale credentials                 |
| channel configured                             | sending to the wrong place        |
| linked users verified in last 180 days         | fingerprint staleness             |
| stored fingerprints match current pubkeys      | silent key swap                   |
| workspace SSO + MFA attestation <= 90 days     | forgotten MFA policy              |
| connected-apps unchanged since baseline        | new archiver / DLP mirroring      |

If any check fails, `send` and `receive` refuse to run until you fix
the issue and re-run `doctor`. This is fail-closed by design. If you
see a failure, do not override it: investigate.

### When something drifts

- **New connected app**: someone installed an app in the workspace.
  Audit it. If it does not touch ciphertext and you trust it, run
  `slack doctor --accept` to re-baseline. If it does touch ciphertext,
  remove it.
- **Fingerprint drift for a linked user**: somebody's NaCl keys have
  been rotated behind your back. **Stop sending to that user.** Call
  them on a voice line, confirm the new fingerprint, and re-run
  `jseeqret slack link`. If they did not rotate, treat this as a
  potential compromise.
- **Token >90 days old**: run `jseeqret slack logout` followed by
  `jseeqret slack login` to rotate.
- **MFA attestation expired**: re-confirm workspace settings and
  run `slack doctor --accept`.

### Offboarding a teammate

When Bob leaves the team:

1. Remove Bob from the Slack workspace (or at least from `#seeqrets`).
2. On your vault, clear the Slack binding or remove Bob's user record
   entirely, depending on whether you want to keep historical context.
3. **Rotate every secret Bob ever received** from the vault. NaCl
   Box has no forward secrecy, so any ciphertext Bob could have
   captured before leaving remains decryptable with his private key.
   Rotation at the upstream credential source is the only mitigation.

## Incident response

If a teammate's machine is compromised or a private key is suspected
leaked:

1. Remove the teammate from `#seeqrets` immediately.
2. Rotate every secret they had access to, in the upstream systems
   that issue the credentials. jseeqret cannot do this for you.
3. Break the local Slack binding so no further sends go to their old
   key (`jseeqret slack link <user> --handle ''` or remove the user).
4. If the operator's own vault was compromised, rotate the Slack
   user token (`slack logout` + `slack login`) and assume every
   ciphertext ever posted to `#seeqrets` is now retroactively
   decryptable. Rotate every secret, full stop.

## Admin commands at a glance

```
jseeqret init [dir]                              # create a new vault
jseeqret add user --username --email --pubkey    # add a local user
jseeqret users                                   # list users
jseeqret slack login                             # OAuth + channel picker
jseeqret slack logout                            # wipe Slack config
jseeqret slack status                            # show current state
jseeqret slack link <user> [--handle]            # bind by fingerprint
jseeqret slack doctor [--accept]                 # preflight + baseline
```

The send/receive flow is covered in [`end-user.md`](end-user.md); it
is identical for admins and end-users.
