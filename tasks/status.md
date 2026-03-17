# Status

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
