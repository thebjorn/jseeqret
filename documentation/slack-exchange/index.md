# Slack Channel as Exchange Transport

## Problem

Vault-to-vault communication needs a delivery channel. The existing models
are:

- **File-based exchange** -- user manually emails/copies an encrypted export.
- **Shared directory (mailbox)** -- cloud-synced inbox folder.
- **Vault service API** -- run an HTTP service between vaults.

File exchange is clunky. Mailboxes require shared infrastructure and polling.
A vault service is the nicest UX but demands we build, deploy and secure a
web server -- which is a non-trivial amount of work and attack surface.

## Idea

Use a (preferably private) Slack channel as the transport layer.

The payload is still the existing NaCl-encrypted export blob. Slack is only
the pipe. `jseeqret send --to bob` would post the encrypted blob (as a file
upload or a code block) to a pre-agreed channel, and Bob's `jseeqret receive`
would poll Slack for messages tagged for him and decrypt them locally.

### Why it is attractive

1. **Zero infrastructure**. No server to run, deploy or patch. Slack hosts
   the queue, handles delivery, retention and audit logging.
2. **It matches current behaviour**. Most small teams already paste secrets
   into private Slack DMs/channels today. Formalising this gives us a clear
   win over "copy the Fernet token into DM" without asking users to change
   habits.
3. **Comparable security to a mailbox drive**. A shared OneDrive folder and
   a private Slack channel have very similar threat models: a third party
   (Microsoft / Salesforce) holds ciphertext, and access is governed by
   account credentials on the operator's side.
4. **Much less hassle than a web service**. No TLS certificates, no port
   forwarding, no authentication service, no uptime SLA, no firewall rules.
5. **Built-in identity**. Slack user IDs and workspace membership give a
   first-pass "who is Bob" mapping that we can bind the NaCl public key to.
6. **Auditability for free**. Slack retains who posted what and when, which
   is useful for incident response.

## Sketch of the Mechanism

```
alice$ jseeqret send API_KEY --app myapp --to @bob --via slack
  -> builds NaCl-encrypted export for bob's pubkey
  -> uploads file "api_key.jsenc" to #jseeqret-exchange
  -> posts "<@bob> inbound: api_key.jsenc" in thread

bob$ jseeqret receive --via slack
  -> slack.conversations.history since last_seen_ts
  -> downloads any files where recipient == me
  -> decrypts with bob's private.key, imports
  -> posts ":white_check_mark: received" in thread
```

A minimal Slack Bot token (`files:read`, `files:write`, `chat:write`,
`channels:history`) is the only credential jseeqret has to hold. The token
lives in the sending/receiving vaults themselves (it is, after all, a
secret).

### Channel layout options

- **One shared channel per team** (e.g. `#jseeqret-exchange`): simple,
  everyone sees message *metadata*, only the intended recipient can decrypt.
- **Per-recipient DM**: tighter, but requires a bot per pair.
- **Private group DM**: middle ground; scoped to the people who need to see
  the audit trail.

## Relationship to Other Features

| Feature                                  | Relationship                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| [Vault-to-Vault](../vault-to-vault/)     | Slack is a concrete implementation of "Model B: Shared mailbox".   |
| [Linked Vault](../linked-vault/)         | Same threat model; third-party cloud holds ciphertext.             |
| [Server Vault](../server-vault/)         | Alternative to running a vault service for admin -> server pushes. |
| [Multi-Vault](../multi-vault/)           | Slack user handle can be the addressable vault name (`--to @bob`). |

## Use Cases

### UC1: Ad-hoc sharing
Alice posts `API_KEY` to Bob via the team channel. Bob's vault pulls it on
the next `receive` (or a tray-icon poller).

### UC2: Small team onboarding
New hire joins `#jseeqret-exchange`. Admin runs a bulk send; newcomer runs
`jseeqret receive` and is provisioned with a vault.

### UC3: Incident response
Security replies to an incident by rotating and re-sending secrets to the
channel. The Slack history is the rotation audit trail.

## Open Questions

1. **Message size**: NaCl-encrypted exports are usually small, but bulk
   exports can exceed Slack's code-block limits. Use file uploads (~1 GB
   max) rather than inline text.
2. **Polling vs. events**: Does `jseeqret receive` poll, or do we run a
   long-lived Socket Mode listener? Polling is simpler but laggy.
3. **Bot token storage**: The bot token is itself a secret. Storing it in
   the vault is fine, bootstrapping it is the hard bit.
4. **Retention**: Slack's message retention can be set per-workspace. Do we
   insist on "delete after 7 days" for exchange channels? This plays into
   forward-secrecy concerns.
5. **Deletion semantics**: Should `jseeqret receive` delete the Slack
   message after import, or leave it for audit?

## Documents

- [Security Concerns](security-concerns.md)
