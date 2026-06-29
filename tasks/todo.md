# TODO

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
- Trust gate: `from_pubkey` rides in `user_list`/`secret_batch`/`complete`
  envelopes, validated against the OOB-verified TL fingerprint (mirrors
  `slack link`). Re-validated in core (`onboard_approve` + import gates).
- Added an `invite` envelope kind (steps 1-4) so the new user discovers the TL
  slack id + fingerprint; the plan only named the step 7-16 kinds.

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

Implemented end to end. Core (`src/core/onboarding.js`, `serializers/envelope.js`,
`serializers/user-list.js`, `slack/session.js`, migration v004, storage CRUD) is
fully unit-tested via an in-memory mock Slack workspace (`tests/slack-mock.js`):
the complete invite→introduce→approve→provision handshake runs across two vaults,
including the wrong-fingerprint refusal and the unknown-sender rejection. CLI
`onboard` wraps the same primitives; IPC (`slack:*`, `onboard:*`) + preload +
four Svelte components (SlackStatusCard, OnboardingView, ApproveDialog,
OnboardingWizard) surface them. `pnpm test` green (351 passing); `pnpm build`
clean.

### Verification

- `pnpm test` (vitest) — primary gate.
- `node src/cli/index.js onboard --help`.
- `pnpm build` — electron-vite compiles Svelte/main/preload.
