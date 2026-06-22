# Rotation -- Implementation Plan

## Overview

This plan covers *active* rotation: safely replacing a secret's value and
propagating the new value to everything that depends on it. It builds on
[Auto-Rotation](../auto-rotation/), which already adds `expires_at` /
`rotated_at` tracking and the `audit` command. Where auto-rotation
answers *"what is stale?"*, this feature answers *"replace it safely
without breaking consumers."*

The guiding principle from [research.md](research.md): a vault can
automate the *change*, but only the surrounding system can automate safe
*adoption*. So the core of jseeqret stays simple and trustworthy
(stage → verify → promote → retire), and the messy provider-specific
parts (calling GitLab's API, driving the Font Awesome web UI) live in
opt-in, out-of-core rotation hooks.

### Scope

In scope:
- Staged rotation (dual-credential pattern) with explicit promote/retire.
- A `rotate` CLI command orchestrating the workflow.
- Propagation reusing existing sync/push, not a new transport.
- An opt-in rotation-provider hook interface for self-rotating tokens and
  web-only services.

Out of scope (documented as future extension points):
- Becoming a dynamic-secret broker (Vault-style lease issuance).
- Built-in OIDC/short-lived-token federation.
- A standing daemon. Rotation is triggered by the user, cron, or CI.

## Phase 1: Versioned Secret Values (Staged Rotation)

### Goal
Stop overwriting secrets in place. Stage a new value, verify it, then
promote — mirroring AWS's `AWSPENDING` → `AWSCURRENT` → `AWSPREVIOUS`.

### Schema

```sql
ALTER TABLE secrets ADD COLUMN pending_value  TEXT DEFAULT NULL;
ALTER TABLE secrets ADD COLUMN previous_value TEXT DEFAULT NULL;
ALTER TABLE secrets ADD COLUMN rotation_state TEXT DEFAULT NULL;
```

- `pending_value` / `previous_value` are Fernet-encrypted exactly like
  the current value.
- `rotation_state` is one of `null` (steady), `pending`, or `promoted`.
- All columns nullable; the Python `seeqret` tool ignores unknown columns
  and steady-state secrets look identical to today. Use the existing
  `column_exists()` guards before touching them.

### State machine

```text
steady ──stage──> pending ──promote──> promoted ──retire──> steady
                     │                                  ▲
                     └──────────── rollback ────────────┘
```

- **stage**: write `pending_value`, set state `pending`. Current value is
  untouched and still served.
- **promote**: move current → `previous_value`, `pending_value` →
  current, set state `promoted`, set `rotated_at = now()`.
- **retire**: clear `previous_value`, set state back to steady.
- **rollback**: from `pending`, discard `pending_value`. From `promoted`,
  restore `previous_value` as current.

### Deliverables
- Migration adding the three columns.
- `Secret` model methods: `stage(value)`, `promote()`, `retire()`,
  `rollback()`, plus `rotation_state` accessor.
- `SqliteStorage` support for reading/writing the new columns.
- Tests for every state transition and Python backward compatibility.

## Phase 2: The `rotate` Command

### Goal
A single command that drives the dual-credential workflow end to end.

### Commands

```powershell
# Stage a new value (does not change what consumers read yet)
jseeqret rotate stage DB_PASSWORD --app myapp --env prod --value "newpass"

# Verify the staged value works, then promote it
jseeqret rotate promote DB_PASSWORD --app myapp --env prod --verify "<cmd>"

# Drop the old value once consumers have adopted the new one
jseeqret rotate retire DB_PASSWORD --app myapp --env prod

# Abort and restore
jseeqret rotate rollback DB_PASSWORD --app myapp --env prod

# Show what is mid-rotation across the vault
jseeqret rotate status
```

`--verify "<cmd>"` runs an arbitrary command (e.g. a test connection) with
the staged value injected via environment variable; promotion only
proceeds on exit code 0. This is the validation step from the research's
four-step flow.

### `rotate status` output

```
  APP    ENV    KEY            STATE      SINCE
  myapp  prod   DB_PASSWORD    pending    2026-06-22 (staged, not promoted)
  myapp  prod   API_KEY        promoted   2026-06-20 (old value still kept)
```

### Deliverables
- `src/cli/commands/rotate.js` with `stage`/`promote`/`retire`/
  `rollback`/`status` subcommands.
- `src/core/rotation.js` orchestrating the state machine and `--verify`.
- Tests covering the happy path, failed verification, and rollback.

## Phase 3: Propagation

### Goal
Get the new value to other vaults and running applications — reusing
existing mechanisms rather than inventing a new one.

### Via sync / push (no new transport)

- A promoted value carries a fresh `updated_at`, so
  [sync-merge](../sync-merge/) propagates it on the next
  [linked-vault](../linked-vault/) sync automatically.
- For directed delivery, reuse [vault-to-vault](../vault-to-vault/) push:

```powershell
jseeqret rotate promote DB_PASSWORD --app myapp --env prod
jseeqret push --vault server-prod --filter "myapp:prod:DB_PASSWORD"
```

### Application adoption

This is the part the vault cannot fully own. Surface, don't enforce:
- Server applications reload via the [server-vault](../server-vault/) file
  watcher and reconnect with the new value.
- The dual-credential window (Phase 1 keeps `previous_value` until
  `retire`) means a consumer that has not yet reloaded still authenticates
  with the old value. **Do not `retire` until adoption is confirmed.**

### Deliverables
- Document the promote → sync/push → confirm → retire sequence.
- `rotate status --rotated-since <date>` to list who still needs the new
  value (cross-references the user list / ACL where present).
- Integration tests with linked-vault sync.

## Phase 4: Rotation-Provider Hooks (Opt-In, Out of Core)

### Goal
Support provider-specific rotation (self-rotating tokens, web-only
services) without polluting the trusted core. Hooks are user-authored,
explicitly enabled, and clearly marked best-effort.

### Hook interface

A provider hook is a small module resolving `{ rotate(context) }`, where
`context` exposes the current value and a way to stage a new one. The
core never imports a hook unless the secret is configured to use it.

```javascript
// example: gitlab-self-rotate.js
export async function rotate({ current_value, stage }) {
    const next = await fetch_new_gitlab_token(current_value)  // self-rotate
    await stage(next)              // feeds Phase 1's pending_value
    return { verify_env: 'GITLAB_TOKEN' }
}
```

```powershell
# Bind a secret to a rotation provider
jseeqret rotate set-provider GITLAB_TOKEN --app ci --env prod \
    --provider ./hooks/gitlab-self-rotate.js

# Then a normal rotate uses it
jseeqret rotate stage GITLAB_TOKEN --app ci --env prod --auto
```

### Patterns this enables (from the research)

- **Token self-rotation** — GitLab cron `git pull`: the hook uses the
  current token to mint its successor via the API, bypassing MFA. Set the
  token TTL longer than the cron interval for graceful degradation.
- **Token exchange** — Font Awesome: the hook keeps a hidden master token
  and exchanges it for short-lived JWTs; the secret jseeqret serves is the
  ephemeral JWT.
- **Web-UI automation (last resort)** — a Playwright/Puppeteer hook that
  drives a vendor's "Regenerate" button. Documented as brittle and
  intentionally outside the supported core.

### Deliverables
- Hook loader with explicit per-secret opt-in (never auto-discovered).
- `rotate set-provider` / `--auto` wiring into Phase 2's workflow.
- Reference hooks for the three patterns above, under `examples/`.
- Tests for the loader and a mock provider; example hooks are not part of
  the coverage gate.

## Phase 5: GUI Integration

### Goal
Surface rotation state in the Electron GUI.

### Design
- **Rotation badges**: secrets mid-rotation (`pending` / `promoted`) show a
  distinct indicator in the list view.
- **Rotate wizard**: stage → verify → promote → retire as a guided flow
  with a clear "old value still accepted" indicator during the window.
- **Status panel**: everything currently mid-rotation, with how long it has
  been staged/promoted (nudges users to retire stale `previous_value`s).

### Deliverables
- Rotation state indicators in the secret list.
- Rotate wizard component and IPC handlers.
- Status panel.

## Security Considerations

1. **Rotation ≠ revocation.** Promoting a new value in jseeqret does not
   invalidate the old credential at the provider. The admin (or a Phase 4
   hook) must revoke it at the source. Make this explicit in command
   output.
2. **`previous_value` is a live secret.** Keeping the prior value for the
   dual-credential window doubles the exposure for that key. `retire`
   must wipe it, and `rotate status` should flag long-lived `promoted`
   states.
3. **`--verify` runs arbitrary commands.** The staged value is injected
   into a child process environment. Document the injection surface; never
   log the value; prefer env-var injection over command-line args.
4. **Hooks execute untrusted code.** Phase 4 hooks run with the user's
   privileges and see plaintext secrets. They are opt-in per secret, never
   auto-loaded, and the web-UI-automation pattern is flagged as brittle and
   unsupported.
5. **Clock and TTL coupling.** For self-rotating tokens, the provider TTL
   must exceed the rotation interval, or a single failed run locks the
   account out. Document the safe-window requirement.

## Open Questions

1. **Value history depth.** Phase 1 keeps exactly one `previous_value`. Is
   a deeper `rotation_history` table worth the storage and exposure?
   Recommendation: single previous value for v1.
2. **Auto-retire.** Should `previous_value` be retired automatically after
   a configurable window, or always require an explicit `retire`?
   Recommendation: explicit for v1; a `--retire-after` convenience later.
3. **Provider hooks in core vs. plugin package.** Should reference hooks
   ship in this repo or a separate `@jseeqret/rotation-hooks` package to
   keep the brittle code out of the audited core? Recommendation: separate
   package, examples only in this repo.
4. **Coordinating the Python `seeqret` side.** The new columns need a
   matching migration in the Python tool before staged rotation is used in
   a shared database. Track as a cross-project dependency.
