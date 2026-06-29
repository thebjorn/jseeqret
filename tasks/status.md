# Status

## GUI-first Onboarding (2026-06-29)

Implemented `documentation/onboarding/plan.md` end to end (all 9 phases):
automated new-user onboarding over the Slack exchange transport, driven from
the Electron GUI with `jseeqret onboard` CLI subcommands as thin wrappers over
the same `src/core` primitives. Committed as `91211a5`.

### Completed

- [x] **Typed envelopes** — `serializers/envelope.js` (`{v,kind,payload}`;
  legacy untyped blobs decode as `secret`); `transport.send_payload` /
  `poll_envelopes`
- [x] **User payload** — `serializers/user-list.js` (NaCl-Box user records)
- [x] **Onboarding state** — migration **v004** `onboarding` table (+`pubkey`)
  + `SqliteStorage` CRUD
- [x] **Slack session over IPC** — `slack/session.js` (shared OAuth/channel/
  preflight) + `slack:*` handlers + preload bridge
- [x] **Orchestration** — `onboarding.js`: invite / poll / approve / join /
  receive-invite / provision-poll, import gates, expiry, trust context
- [x] **GUI** — OnboardingWizard (first-run), OnboardingView (TL panel),
  ApproveDialog (fingerprint gate), SlackStatusCard; sidebar + App wiring
- [x] **CLI** — `onboard invite/status/watch/join/receive/approve`
- [x] **Security hardening** (post adversarial review) — full-pubkey import
  auth (not the 20-bit fingerprint), Box-proof `complete`, poll robustness,
  history pagination, re-invite guard, resumable/idempotent approve
- [x] **GUI vault migration** — main process migrates the active vault on
  startup + on switch (fixes `no such table: onboarding` on pre-v004 vaults)

### New core/cli/main files

- `src/core/onboarding.js`, `src/core/serializers/envelope.js`,
  `src/core/serializers/user-list.js`, `src/core/slack/session.js`
- `src/cli/commands/onboard.js`
- `src/renderer/.../{OnboardingWizard,OnboardingView,ApproveDialog,SlackStatusCard}.svelte`
- 8 new test files incl. `tests/slack-mock.js` (in-memory Slack workspace)

### Tests

`pnpm test` → 36 files, **361 passing** / 5 skipped. `pnpm build` clean.

## Gap Analysis Implementation (2026-03-17)

All 6 items from the Python seeqret gap analysis have been implemented:

### Completed

- [x] **CLI command tests** — 6 new test files (57 tests), total now 14 files / 127 tests
- [x] **`add text`** — multi-line secret input via stdin (src/cli/commands/add.js)
- [x] **`export --windows`/`--linux`** — platform flags on export command + serializer support
- [x] **Windows NTFS cipher hardening** — EFS encryption, icacls, attrib during init (src/core/fileutils.js)
- [x] **`server init`** — headless server vault initialization (src/cli/commands/server.js)
- [x] **`--log` global option + `info --dump`** — logging infrastructure + JSON info dump

### New files

- `src/cli/commands/server.js` — server command group
- `src/core/fileutils.js` — Windows NTFS hardening utilities
- `src/core/logger.js` — logging module (DEBUG/INFO/WARNING/ERROR)
- `tests/cli-helpers.js` — CLI test helper (create_test_vault, run_command)
- `tests/cli-init.test.js` — init command tests (4)
- `tests/cli-secrets.test.js` — add/list/get/edit/rm tests (18)
- `tests/cli-users.test.js` — users/owner/whoami/keys tests (5)
- `tests/cli-info.test.js` — info/upgrade/serializers tests (6)
- `tests/cli-export.test.js` — export/backup/load tests (9)
- `tests/cli-env.test.js` — env/importenv tests (9)

### Modified files

- `src/cli/commands/add.js` — added `add text` subcommand
- `src/cli/commands/export.js` — added `-w`/`-l` platform flags
- `src/cli/commands/info.js` — added `--dump`, richer vault info
- `src/cli/commands/init.js` — added NTFS hardening call
- `src/cli/index.js` — added `--log` global option, server command
- `src/core/serializers/base.js` — `dumps()` accepts `system` parameter
- `src/core/serializers/command.js` — platform-aware line endings

## Bug Fix Status (2026-03-17)

7 of 8 code review issues have been fixed:

### Fixed

- [x] **setenv.js** — Command injection: now uses `execFileSync` with args array
- [x] **command.js** — `load()` now strips command prefix before parsing fields
- [x] **vault.js** — `is_initialized()` now uses `get_seeqret_dir()` with try/catch
- [x] **add.js** — `add key` now checks for duplicates before insert
- [x] **server.js** — Guards against overwriting existing vault keys
- [x] **cli/utils.js** — `validate_current_user()` is now async with await
- [x] **sqlite-storage.js** — `_where_field_or` correctly handles `*` as wildcard

### Remaining

- [ ] **export --windows/--linux** — Platform flags silently ignored by non-command serializers (minor)
