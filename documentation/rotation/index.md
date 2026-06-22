# Rotation

Rotating secrets is one of the highest-value, lowest-adoption security
practices in production systems. This document distills the research in
[research.md](research.md) into a working overview: why rotation is hard,
what the industry actually does, and which of those patterns jseeqret can
realistically support. The concrete proposal lives in [plan.md](plan.md).

This is the *active* counterpart to [Auto-Rotation](../auto-rotation/),
which tracks expiration and rotation metadata but never changes a value.
Rotation is about safely *replacing* a secret and getting the new value
to everything that depends on it.

## The Core Problem

Updating a secret is easy. Propagating it everywhere that depends on it
is the hard part, and it is where systems fall apart:

- **Untracked dependency chains.** A password change can succeed in the
  vault but fail in a legacy cron job, a third-party SaaS integration, or
  a forgotten sidecar — a silent partial outage.
- **Tight coupling.** Applications hard-coded to read a static credential
  once at boot do not notice a rotation until they are restarted.
- **Messy reality.** Certificate chains, embedded mobile integrations,
  and API keys that resist clean offboarding all complicate the swap.

The recurring lesson: a secret manager can automate the *change*, but
only the surrounding system can automate safe *adoption*.

## The State of Standards

There is no single rotation standard — there is a mix of legacy
compliance rules and newer guidance that often conflict.

- **Human passwords.** NIST and Microsoft now advise *against* mandatory
  rotation, because forced changes lead to weaker passwords. Yet PCI DSS
  and many auditors still require it — a compliance-versus-security
  conflict.
- **Machine secrets.** For API keys and tokens, the guidance is the
  opposite: aggressive rotation, often every 30–90 days or shorter.
- **No interoperability.** There is no "USB-C for secrets" — no standard
  protocol that lets a secret rotated in one system automatically update
  a service running somewhere else. That fragmentation is why the space
  *feels* like it has no standards even though tools exist.

## How Automation Works in Practice

Mature systems do not "rotate a file in place" and hope every client
notices. They either issue short-lived credentials on demand, or run a
controlled workflow that stages a new version, tests it, then promotes
it.

| Model | Mechanism | Trade-off |
| --- | --- | --- |
| **Dynamic secrets** (Vault) | Generate credentials on demand with a lease/TTL; renew or re-issue | Clients must fetch at runtime and survive lease expiry |
| **Scheduled + versioned** (AWS Secrets Manager) | Staged `AWSPENDING` → `AWSCURRENT` → `AWSPREVIOUS` four-step flow | Clients must detect and reload the new version |
| **Short-lived tokens / OIDC** | Identity is exchanged for a temporary session credential (e.g. GitHub Actions → AWS) | No standing secret to rotate, but requires a trust relationship |

### Key patterns worth borrowing

- **Dual-credential rotation.** The target accepts two valid credentials
  at once. Rotate B while A is still in use, confirm B works, switch,
  then retire A after a safe window. This is the safest way to rotate
  without a coordinated downtime event.
- **Just-in-time / dynamic secrets.** Instead of rotating a stored value,
  mint a short-lived account on demand and delete it when the lease ends.
  There is no static secret left to steal.
- **Token self-rotation.** A short-lived token uses *itself* to request
  its successor via the provider's API, sidestepping the interactive MFA
  prompt a human login would require (the GitLab cron `git pull` case).

## The Awkward Cases

Not every service cooperates. The research highlights two that jseeqret
users will hit in the real world:

- **Web-UI-only token services (e.g. Font Awesome).** No
  `POST /tokens/rotate` endpoint. Options, in order of preference:
  exchange a hidden master token for short-lived JWTs at runtime; route
  all traffic through a single internal proxy so only one place holds the
  static token; or, as a brittle last resort, drive the web UI with a
  headless browser.
- **Self-rotating local tokens (e.g. GitLab cron).** A scheduled script
  rotates its own token before it expires, writes the new value back,
  verifies access, and revokes the old one. The expiry window must be
  longer than the cron interval so a single failed run degrades
  gracefully instead of locking you out.

## Verdict

| Claim | Accuracy | Notes |
| --- | --- | --- |
| Rotation is where systems fall apart | **Accurate** | Top cause of self-inflicted downtime, due to untracked dependencies and tightly-coupled legacy code. |
| There are no standards | **Mixed** | Standards exist (NIST, SOC 2) but conflict for human credentials and fragment across vendors. |
| There is no automation | **Inaccurate** | High-quality tools exist (Vault, AWS Secrets Manager, CyberArk, Doppler); adoption is low because implementation is complex. |

## Where jseeqret Fits

jseeqret is a local-first, file-based vault — it is not Vault and should
not try to be. Its realistic role is:

1. **Track** rotation state (covered by [Auto-Rotation](../auto-rotation/)).
2. **Stage and promote** new secret versions safely (dual-credential
   pattern), rather than overwriting in place.
3. **Propagate** rotated values to other vaults via existing
   [linked-vault](../linked-vault/) sync and
   [vault-to-vault](../vault-to-vault/) push.
4. **Drive provider-specific rotation** through optional, pluggable
   hooks (token self-rotation, web-UI automation) — explicitly out of the
   trusted core, opt-in, and clearly marked as best-effort.

The detailed, phased proposal is in [plan.md](plan.md).

## Documents

- [research.md](research.md) — Full research notes and external references.
- [plan.md](plan.md) — Phased implementation plan for jseeqret.
- [Auto-Rotation](../auto-rotation/) — Expiration and rotation *tracking*
  (the passive companion to this feature).
