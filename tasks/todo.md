# TODO

## Fix: first-run wizard unmounts after vault creation (2026-07-02)

Root cause of the sandbox onboarding failure: `App.svelte` shows
`OnboardingWizard` only while `!vault_status.initialized`. The wizard's own
create step flips `initialized` to true, so the wizard unmounts before the
Slack/introduce steps ever render — on a fresh machine the Slack onboarding
is unreachable, and the user falls back to the manual Introduction view
(placeholder `user@host` email, which the TL can never match to the invite).

Secondary: `onboard_provision_poll` warnings are never surfaced (silent
stall in the waiting step), and the packaged app writes no logs at all.

### Plan

- [x] Core: `onboard.wizard` kv flag + `get_wizard_state`/`set_wizard_state`
      in `src/core/onboarding.js` (+ tests in `tests/onboarding.test.js`)
- [x] Main: `vaults:create` takes `{ onboarding }` and sets the flag on the
      new vault; `vault:status` returns `onboarding_active`; new
      `onboard:wizard-done` handler clears the flag
- [x] Main: `src/main/logger.js` (plain fs append, size-capped rotation,
      no electron import); init from `src/main/index.js` with
      `app.getPath('userData')/logs`; log app start, updater events,
      uncaught errors (via `uncaughtExceptionMonitor` so default fatal
      handling is preserved)
- [x] Main: wrap `ipcMain.handle` registrations in a logging `handle()`
      helper (failures logged with channel name); info-logs for key
      onboarding events; `app:open-logs` handler
- [x] Preload: `createVault(opts)`, `onboardWizardDone()`, `openLogs()`
- [x] Renderer: `App.svelte` keeps wizard mounted while
      `!initialized || onboarding_active`; wizard passes
      `{ onboarding: true }` to createVault, clears the flag on finish,
      gains a "Skip" escape hatch (team-lead bootstrap) and shows
      provision-poll warnings in the waiting step; "Open logs" affordance
      in wizard + sidebar
- [x] Verify: pnpm test, pnpm build, review diff

### Follow-ups implemented (2026-07-02, user confirmed)

- [x] (i) Auto-introduce: `onboard_introduce` core primitive (idempotent
      per invited email via `onboard.introduced` kv marker, `force` for
      recovery), `onboard:introduce` IPC, wizard auto-sends when the
      invite is found; `onboard:join` now anchors trust + skips the
      duplicate send; CLI `onboard join` uses the same primitive with
      force. Voice-call gate unchanged (introduction carries only the
      user's own pubkey).
- [x] (ii) Display name: migration v005 (`users.name` +
      `onboarding.name`), User model/storage/serializer threading,
      invite `--name` no longer clobbered by the introduction's
      machine identity, approve stores name + derives handle from it,
      GUI (UserList/OnboardingView/ApproveDialog) and CLI
      (`add user --name`, `users` table/--export) surfaces.
- [x] Python seeqret mirror: `db_v_004` (onboarding table, keeps the
      shared version ladder aligned) + `db_v_005` (name columns),
      User model + storage + `add user --name`. Found and fixed a
      latent bug in `migrations/utils.py`: double-quoted literals in
      `column_exists` resolve as identifiers (`name="name"` ≡
      `name=name`, always true), which silently skipped the v005
      ALTER TABLE. Remaining 3 test failures in
      tests/test_resolve_user.py are pre-existing machine-dependent
      fixtures (admin = current_user() = 'bjorn' collides), verified
      identical on the clean checkout.

### Verification

- `pnpm test` — 417 passing / 5 skipped, 45 files (2 new: wizard-flag
  tests in onboarding.test.js, tests/main-logger.test.js).
- `pnpm build` — main/preload/renderer compile clean.
- `VaultSwitcher.createVault()` passes no opts → additional vaults never
  set the wizard flag (existing users unaffected).
- Not yet exercised on a real fresh install: the create → slack →
  introduce transition in the packaged app (needs the native folder
  dialog). Sandbox test plan: install, create vault, confirm the wizard
  STAYS on "Connect Slack", finish onboarding; logs land in
  %APPDATA%\jseeqret\logs\main.log.

## Multi-Vault Feature

### Plan

**Design:**
- `~/.seeqret/vaults.json` registry maps names → absolute paths. A `_default` key
  stores the name chosen by `vault use`.
- `get_seeqret_dir(override=null)` in `vault.js`:
  - Absolute path value → return as-is (100% backward-compatible for existing users)
  - Non-path value (no `/`) → registry lookup
  - No env var set → check registry `_default` → fall back to `/srv/.seeqret`
- CLI `--vault <name>` global option: `preAction` hook resolves name → path, sets
  `process.env.JSEEQRET`. Zero changes to individual commands.
- `vault use <name>` writes `_default` to registry; future invocations with no env var
  pick it up automatically.

**Files:**
| File | Action |
|------|--------|
| `src/core/vault-registry.js` | Create – registry CRUD + resolve |
| `src/cli/commands/vault.js` | Create – vault list/add/remove/use |
| `tests/vault-registry.test.js` | Create – unit tests |
| `src/core/vault.js` | Modify – name resolution in `get_seeqret_dir` |
| `src/cli/index.js` | Modify – `--vault` global option + vault command |

### Tasks

- [x] Create `src/core/vault-registry.js`
- [x] Write tests in `tests/vault-registry.test.js`
- [x] Update `src/core/vault.js` to support name resolution
- [x] Create `src/cli/commands/vault.js` (list, add, remove, use)
- [x] Update `src/cli/index.js` (global `--vault` option + vault command)
- [x] Run full test suite and verify all tests pass

## Critical

- [x] **setenv.js:53 — Command injection via secret value**
- [x] **command.js serializer — `load()` cannot parse file-based output**

## Important

- [x] **vault.js:34 — `is_initialized()` ignores default Linux path**
- [x] **add.js — `add key` crashes with raw SQLite error on duplicate**
- [x] **server.js — Silently overwrites keys if vault already exists**
- [x] **cli/utils.js:96 — `validate_current_user()` missing await**

## Minor

- [x] **sqlite-storage.js:96 — `_where_field_or` treats `'*'` as literal**
- [ ] **export --windows/--linux silently ignored by most serializers**

## Onboarding (GUI-first) — implementing documentation/onboarding/plan.md

Tests cover `src/core/` (per CLAUDE.md); CLI/IPC/GUI are thin wrappers over the
same core primitives. **Test-first.**

### Design decisions (grounded in the codebase)

- Envelope `{ v, kind, payload }`; absent `kind` => legacy `secret`. New
  `src/core/serializers/envelope.js`.
- Transport: add `send_payload()` + `poll_envelopes()` next to the existing
  `send_blob()`/`poll_inbox()` (non-breaking; `receive`/`send` keep working).
- `UserListSerializer` mirrors `JsonCryptSerializer`; encrypts the whole list as
  one NaCl Box so the username->pubkey binding is authenticated end to end.
- Migration v004 `onboarding` table — schema from the plan **plus a `pubkey`
  column**: approve needs the user's pubkey, and it must survive Slack's 24h
  retention exactly like the captured fingerprint does.
- Trust gate (hardened after the adversarial review — see `lessons.md`):
  imports authenticate by NaCl-Box-decrypting with the **full** OOB-verified
  TL pubkey (`trusted_pubkey`), NOT the 5-char fingerprint — a 20-bit
  fingerprint is forgeable by an offline collision because the attacker
  controls the envelope's `from_pubkey`. The fingerprint is only the human
  voice-call display, recomputed from the anchored pubkey at join. The
  `complete` ack carries a NaCl-Box proof. Re-validated in core
  (`onboard_approve` + import gates), not just the GUI checkbox.
- Added an `invite` envelope kind (steps 1-4) so the new user discovers the TL
  slack id + pubkey/fingerprint; the plan only named the step 7-16 kinds.
- GUI migrates the active vault on startup + on switch (`ensure_migrated`),
  so vaults predating a migration (e.g. v004) gain new tables.

### Phases

- [x] Phase 1 — Typed envelopes: `serializers/envelope.js`; transport
      `send_payload`/`poll_envelopes`. Tests: round-trip each kind; legacy blob.
- [x] Phase 2 — User payload: `serializers/user-list.js` + import gated on
      verified sender. Tests: accept verified, reject unknown.
- [x] Phase 3 — Onboarding state: migration v004 + `SqliteStorage` CRUD. Tests:
      transitions, list/filter, expiry.
- [x] Phase 4 — Slack session over IPC: `slack/session.js` + `slack:*` handlers
      + preload. Tests: preflight/doctor gate.
- [x] Phase 5 — Team Lead panel: `onboard_invite`/`onboard_poll` + Svelte + IPC
      + CLI. Tests: invite persists+posts; watch promotes invited->introduced.
- [x] Phase 6 — New-user wizard: `onboard_join`/provision poll + Svelte + IPC +
      CLI. Tests: introduction posts; import idempotent.
- [x] Phase 7 — Approve + provision: `onboard_approve` + ApproveDialog +
      SlackStatusCard + IPC + CLI. Tests: refuse w/o verification; success path.
- [x] Phase 8 — Hardening: doctor gate, unexpected-handle warn, expiry. Tests.
- [x] Phase 9 — Tests + docs: end-to-end mock handshake; docs + lessons.

### Review section

**Status: implemented, reviewed, hardened, committed (`91211a5`, 2026-06-29).**

Core (`src/core/onboarding.js`, `serializers/envelope.js`,
`serializers/user-list.js`, `slack/session.js`, migration v004, storage CRUD)
is fully unit-tested via an in-memory mock Slack workspace
(`tests/slack-mock.js`): the complete invite→introduce→approve→provision
handshake runs across two vaults, including the wrong-fingerprint refusal,
the forged-sender rejection, and the resumable/idempotent approve. CLI
`onboard` wraps the same primitives; IPC (`slack:*`, `onboard:*`) + preload +
four Svelte components surface them.

Adversarial review (4-dimension find→verify fan-out) confirmed 13 findings;
fixed the substantive ones:
- **High (security):** import gate authenticated on the 20-bit fingerprint —
  forgeable. Now decrypts with the full OOB-anchored TL pubkey.
- `complete` ack now carries a NaCl-Box proof (no plaintext-forge strand).
- `poll_inbox` skips a single bad blob instead of aborting the whole poll.
- `onboard_provision_poll` skips-and-continues per envelope.
- `conversations.history` now paginates (was one 100-message page).
- `onboard_invite` refuses to clobber an in-progress row.
- `onboard_approve` is resumable + idempotent; derives a slack handle.
- Deferred (low, documented): unverified serializer `signature` (Box auth
  covers integrity); user-side poll cursor (delete-after-import makes
  re-scan correct, just not maximally efficient).

Post-review fix: the GUI never migrated existing vaults, so v3 vaults hit
`no such table: onboarding`. The main process now migrates the active vault
on startup + on switch.

### Verification (final)

- `pnpm test` — **361 passing** / 5 skipped, 36 files.
- `node src/cli/index.js onboard --help` — loads.
- `pnpm build` — electron-vite compiles Svelte/main/preload, clean.
