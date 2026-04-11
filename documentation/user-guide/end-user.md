# jseeqret End User Guide

This guide is for you if someone on your team has already set up
jseeqret and asked you to start using it to send and receive secrets.
You do not need to understand the cryptography; you need to know how
to log in, verify fingerprints, and run a handful of commands safely.

If you are the one setting jseeqret up for a team, read
[`admin-guide.md`](admin-guide.md) first.

## What jseeqret does for you

- **Stores your secrets locally** in an encrypted SQLite vault. The
  vault lives on your machine only. There is no cloud.
- **Exchanges secrets through a private Slack channel.** You never
  paste a secret into Slack. jseeqret encrypts the secret for a
  specific teammate's public key, posts the ciphertext as a file,
  and mentions the recipient. Only they can decrypt it.
- **Refuses to send anywhere unsafe.** If the Slack workspace drifts
  (retention lengthened, a new archiver app installed, a recipient's
  key changed behind your back), jseeqret fails closed and tells you
  why. Do not override these errors; talk to your admin.

## One-time setup

### 1. Install jseeqret

Ask your admin which installation they recommend. Typical options:

- `pnpm install -g jseeqret` -- CLI only
- Windows installer -- CLI + Electron GUI
- macOS/Linux package via your admin

Verify with:

```bash
jseeqret --version
```

### 2. Create your vault

```bash
jseeqret init ~/.seeqrets
```

This creates four files inside `~/.seeqrets`:

- `seeqrets.db`  -- your local vault database
- `public.key`   -- **your public key. Share this freely.**
- `private.key`  -- **your private key. Never share this with anyone.**
- `seeqret.key`  -- symmetric key used for at-rest encryption

**Back up `private.key` and `seeqret.key` immediately.** A USB stick
in a drawer is fine. A hardware keystore is better. Without them,
every secret anyone ever sends you is unrecoverable.

### 3. Share your public key with your admin

```bash
cat ~/.seeqrets/public.key
```

Paste the output into a message to your admin (any channel -- the
public key is not secret). They will add you to their vault.

### 4. Verify fingerprints with every teammate

This is the most important step in the whole setup. Your admin will
ask you to confirm a five-character fingerprint of your public key
**out-of-band** (voice call, in-person, any trusted channel that is
NOT Slack). They will read a code like `ab12c` and ask you to type
it back.

When it is your turn to confirm someone else's fingerprint:

1. **Do not accept a fingerprint sent over Slack, email, or any text
   channel.** That is the attack we are defending against. If a
   teammate is asking you to confirm their fingerprint by typing it
   into jseeqret, they should be saying it out loud to you on a
   voice line you trust.
2. Pick up the phone. Ask the teammate to read the five characters
   they see on their screen. Compare them digit-by-digit.
3. Only then type the code into the jseeqret prompt.

If the fingerprints do not match, **do not proceed**. Somebody's
vault has been tampered with, or you are talking to the wrong person.
Hang up and contact your admin out-of-band.

### 5. Log in to Slack

```bash
jseeqret slack login
```

Your browser opens, you sign in to Slack as normal, and jseeqret
stores the resulting token inside your vault (encrypted). Pick the
exchange channel when prompted -- usually `#seeqrets`.

### 6. Run doctor

```bash
jseeqret slack doctor --accept
```

On the first run, `--accept` baselines the workspace's apps and
records your MFA attestation. Agree only if your admin told you that
the workspace has SSO + hardware MFA enforced.

After this, run `jseeqret slack doctor` (no flag) and make sure it
is all-green before sending anything.

## Day-to-day: receiving secrets

```bash
jseeqret receive --via slack
```

This polls the exchange channel once, decrypts everything addressed
to you, imports it into your vault, and deletes the Slack messages
so forward-secrecy is preserved. It prints `Imported N secret(s)`
when anything arrived and is silent otherwise.

For continuous polling (handy for a background tray or a tmux pane):

```bash
jseeqret receive --via slack --watch
```

The default poll interval is 30 seconds. Override with
`--interval 60` if you want to be gentler on Slack.

### When receive fails

- **"inbound blob from unknown Slack handle `@name`"** -- somebody
  is sending you secrets from a handle you have not linked. Ask
  your admin whether they expected this. If yes, add the sender via
  `jseeqret add user` + `jseeqret slack link`. If no, this is a
  potential attack; talk to your admin before doing anything else.
- **"slack doctor" errors** -- run `jseeqret slack doctor` and fix
  whatever it reports. Do not bypass.
- **Nothing imported** -- normal if nobody has sent you anything in
  this polling cycle. Run `jseeqret slack status` to see your
  `last_seen_ts` and confirm the polling is making progress.

## Day-to-day: sending a secret

First, add the secret to your vault (or fetch it from the upstream
system if you have a rotation flow):

```bash
jseeqret add key DB_PASSWORD 's3cr3t' --app myapp --env prod
```

Then send it to Bob:

```bash
jseeqret send 'myapp:prod:DB_PASSWORD' --to bob --via slack
```

jseeqret will:

1. Check that you have linked Bob via `slack link` and that his
   fingerprint still matches the one you confirmed. If not, it
   refuses.
2. Run a quick preflight mirror of `slack doctor`. If anything is
   off (stale token, stale MFA attestation, missing channel), it
   refuses.
3. Build the ciphertext blob, upload it with an opaque filename,
   and post a thread reply that tags Bob by his Slack user ID. The
   thread body contains **only** the mention -- no filename, no
   secret name, no commentary.

You should see output like:

```
Sent 1 secret(s) to bob via Slack (file F1234..., ts 1712345678.001).
```

### What not to do

- **Never paste a secret directly into Slack.** The whole point of
  jseeqret is that the secret lives only in ciphertext, and the
  Slack thread is just a mention. Once you paste plaintext into
  the channel, Slack retention policies, legal discovery, and DLP
  archivers become your problem.
- **Do not send to a user who is not linked via `slack link`.**
  jseeqret will refuse, but do not try to work around it by
  emailing the ciphertext instead.
- **Do not try to work around a `slack doctor` failure.** If the
  tool says the workspace has drifted, it has. Fix the drift.

## Useful everyday commands

```
jseeqret list                         # list the secrets in your vault
jseeqret get 'app:env:key'            # retrieve a decrypted secret
jseeqret rm key 'app:env:key'         # delete a secret locally
jseeqret users                        # list people in your vault
jseeqret slack status                 # show your Slack session state
jseeqret receive --via slack [--watch]# pull secrets addressed to you
jseeqret send <filter>... --to <user> --via slack   # push a secret
```

Run `jseeqret <command> --help` for the full option set on any
command.

## Getting help

1. Run `jseeqret slack status` and `jseeqret slack doctor` and
   send the output to your admin. These two commands surface most
   problems directly.
2. Ask your admin before overriding anything. jseeqret is
   deliberately noisy about security-relevant problems; if it is
   refusing to do something, there is almost always a good reason.
