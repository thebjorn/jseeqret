# TODO

## Critical

- [x] **setenv.js:53 — Command injection via secret value**
  Uses shell string interpolation with user-controlled values. A secret value like `foo" & calc` would execute arbitrary commands. Fix: use `execFileSync('setx', [secret.key, val])` instead.

- [x] **command.js serializer — `load()` cannot parse file-based output**
  `dumps()` outputs full command lines (`jseeqret load -u... -vFP:APP:ENV:KEY:TYPE:ENCRYPTED`), but `load()` splits the raw text on `:` without stripping the command prefix. Loading from a file (`load -s command -f output.txt`) will corrupt all field assignments. Fix: strip `jseeqret load ... -v` prefix before parsing.

## Important

- [x] **vault.js:34 — `is_initialized()` ignores default Linux path**
  Returns `false` immediately when neither `JSEEQRET` nor `SEEQRET` is set, but `get_seeqret_dir()` falls back to `/srv/.seeqret` on Linux. Breaks the `server init` workflow. Fix: use `get_seeqret_dir()` with try/catch instead of checking env vars directly.

- [x] **add.js — `add key` crashes with raw SQLite error on duplicate**
  Does not check for existing secrets before insert. The UNIQUE constraint throws an unhandled error. `add text` already has the correct pre-check pattern. Apply the same to `add key`.

- [x] **server.js — Silently overwrites keys if vault already exists**
  Unconditionally overwrites `private.key`, `public.key`, and `seeqret.key` when the vault directory already exists. Secrets encrypted with the old key become permanently unrecoverable. Fix: add an "already initialized" guard.

- [x] **cli/utils.js:96 — `validate_current_user()` missing await**
  `fetch_users()` is async but called without `await`. The guard is dead code. Currently unused but exported. Fix: make the function `async` and `await` the result.

## Minor

- [x] **sqlite-storage.js:96 — `_where_field_or` treats `'*'` as literal**
  In comma-separated filter values, `*` generates `field = '*'` (literal) instead of `LIKE '%'` (match all). Currently unreachable from CLI but wrong for API consumers.

- [ ] **export --windows/--linux silently ignored by most serializers**
  Only `CommandSerializer` uses the `system` parameter. Other serializers silently ignore it. Consider warning when flags are used with unsupported serializers.
