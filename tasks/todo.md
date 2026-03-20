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
