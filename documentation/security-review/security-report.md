# Security Review Report

**Project:** jseeqret  
**Date:** 2026-04-02  
**Reviewer:** Security Agent (automated + manual review)

## Executive Summary

jseeqret is a secrets manager handling encryption keys, database credentials, and
sensitive data. The core cryptographic and SQL layers are well-implemented with
parameterized queries and proper use of Node.js `crypto`. However, several issues
were identified ranging from a timing-unsafe HMAC comparison in Fernet decryption
(critical for a crypto tool) to a disabled Electron sandbox and missing file
permission hardening on key files.

**Overall risk: MODERATE** -- the highest-impact findings are in the crypto layer
and Electron configuration. The SQL layer is sound.

## Scan Results

| Scanner            | Status        | Findings                               |
| ------------------ | ------------- | -------------------------------------- |
| Semgrep SAST       | Not installed | N/A                                    |
| Gitleaks secrets   | Not installed | N/A                                    |
| npm audit          | Ran           | 4 vulnerabilities (1 moderate, 3 high) |
| Manual grep        | Ran           | See findings below                     |
| Manual code review | Completed     | 22 findings                            |

### npm audit Summary

| Package         | Severity | Advisory                                                                    |
| --------------- | -------- | --------------------------------------------------------------------------- |
| @xmldom/xmldom  | HIGH     | XML injection via unsafe CDATA serialization                                |
| brace-expansion | MODERATE | Zero-step sequence causes process hang / memory exhaustion                  |
| lodash          | HIGH     | Code injection via `_.template`; prototype pollution via `_.unset`/`_.omit` |
| picomatch       | HIGH     | Method injection in POSIX character classes; ReDoS via extglob quantifiers  |

All are fixable via `npm audit fix`.

### Manual Grep Patterns

| Pattern searched                          | Matches                            |
| ----------------------------------------- | ---------------------------------- |
| `Math.random` in src/                     | 0                                  |
| `innerHTML` / unsafe React HTML rendering | 0                                  |
| `Function()`                              | 0                                  |
| `rejectUnauthorized` / `NODE_TLS`         | 0                                  |
| `timingSafeEqual`                         | 0 (should be >0)                   |
| `shell: true`                             | 1 (`src/cli/commands/gui.js:20`)   |
| SQL template literals (`${...}`)          | 2 (`src/core/migrations.js:37,43`) |

---

## Findings

### CRITICAL

#### SEC-01: Timing-Unsafe HMAC Comparison in Fernet Decryption

- **CWE:** CWE-208 (Observable Timing Discrepancy)
- **OWASP:** A02 (Cryptographic Failures)
- **Location:** `src/core/crypto/fernet.js:110`
- **Description:** HMAC verification uses `Buffer.equals()` which performs
  byte-by-byte comparison and returns early on first mismatch. This is not
  timing-safe.
  ```javascript
  if (!Buffer.from(hmac_value).equals(expected_hmac)) {
      throw new Error('Invalid Fernet token: HMAC verification failed')
  }
  ```
- **Impact:** Attackers can forge Fernet tokens by measuring response time
  differences to determine correct HMAC bytes one at a time. This is the most
  critical finding for a secrets manager.
- **Fix:** Use `crypto.timingSafeEqual()`:
  ```javascript
  import { timingSafeEqual } from 'crypto'
  if (!timingSafeEqual(Buffer.from(hmac_value), expected_hmac)) {
      throw new Error('Invalid Fernet token: HMAC verification failed')
  }
  ```

#### SEC-02: Electron Sandbox Disabled

- **CWE:** CWE-693 (Protection Mechanism Failure)
- **OWASP:** A05 (Security Misconfiguration)
- **Location:** `src/main/index.js:17`
- **Description:** The Electron BrowserWindow is created with `sandbox: false`.
  ```javascript
  webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
  }
  ```
- **Impact:** The renderer process has access to Node.js APIs. Any XSS
  vulnerability in the Svelte renderer could lead to full system compromise
  -- arbitrary file read/write, command execution, and secret exfiltration.
- **Fix:** Enable sandbox and explicitly set all security-relevant options:
  ```javascript
  webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
  }
  ```
  Note: this may require adjustments to the preload script.

#### SEC-03: Private Key Exposed to Renderer via IPC

- **CWE:** CWE-200 (Exposure of Sensitive Information)
- **OWASP:** A01 (Broken Access Control)
- **Location:** `src/main/ipc-handlers.js:118-124`
- **Description:** The `vault:keys` IPC handler sends the raw private key to the
  renderer process:
  ```javascript
  ipcMain.handle('vault:keys', () => {
      const vault_dir = get_active_vault_dir()
      return {
          privateKey: load_private_key_str(vault_dir),
          publicKey: load_public_key_str(vault_dir),
      }
  })
  ```
- **Impact:** The private key is accessible in the renderer's JavaScript context.
  Combined with the disabled sandbox (SEC-02), this means any renderer-side
  vulnerability exposes the vault's private key, enabling decryption of all
  transit-encrypted secrets.
- **Fix:** Keep crypto operations in the main process only. Instead of sending
  the private key, expose IPC methods that perform decrypt/sign operations
  server-side and return only the results.

---

### HIGH

#### SEC-04: Key Files Written Without Restrictive Permissions

- **CWE:** CWE-732 (Incorrect Permission Assignment for Critical Resource)
- **OWASP:** A01 (Broken Access Control)
- **Location:** `src/core/crypto/utils.js:30, 59-68`
- **Description:** Symmetric and asymmetric key files are written with default
  OS permissions (typically 0o644 on Unix, world-readable on Windows):
  ```javascript
  fs.writeFileSync(key_path, key, 'utf-8')
  ```
  While `harden_vault_windows()` exists in `fileutils.js` for Windows, it
  only hardens the directory, not individual key files. On Unix systems, no
  permission hardening occurs at all.
- **Impact:** On shared systems, other users can read `seeqret.key`,
  `private.key`, and `public.key`, enabling full decryption of all secrets.
- **Fix:** Set restrictive permissions on key files:
  ```javascript
  fs.writeFileSync(key_path, key, { encoding: 'utf-8', mode: 0o600 })
  ```

#### SEC-05: SQL String Interpolation in Migrations

- **CWE:** CWE-89 (SQL Injection)
- **OWASP:** A03 (Injection)
- **Location:** `src/core/migrations.js:37, 43`
- **Description:** Two SQL queries use template literal interpolation:
  ```javascript
  `SELECT name FROM sqlite_master WHERE type='table' AND name='${table_name}'`
  `PRAGMA table_info(${table_name})`
  ```
- **Impact:** Currently low risk because `table_name` values are hardcoded
  internal strings (`'migrations'`, `'users'`, `'secrets'`). However, this is
  a dangerous pattern in a security-critical application -- if these functions
  are ever called with dynamic input, SQL injection becomes possible.
- **Fix:** Use parameterized queries. Note that `PRAGMA table_info(?)` does not
  support parameter binding in SQLite, so validate table names against an
  allowlist:
  ```javascript
  const ALLOWED_TABLES = new Set(['users', 'secrets', 'migrations'])
  if (!ALLOWED_TABLES.has(table_name)) {
      throw new Error(`Invalid table name: ${table_name}`)
  }
  ```

#### SEC-06: No Content Security Policy in Electron

- **CWE:** CWE-1021 (Improper Restriction of Rendered UI Layers)
- **OWASP:** A05 (Security Misconfiguration)
- **Location:** `src/main/index.js` (missing), renderer `index.html` (missing)
- **Description:** No CSP headers or meta tags are configured. The Electron app
  allows inline scripts, loading resources from any origin, and dynamic code
  execution.
- **Impact:** Increases the exploitability of any XSS vulnerability. Without CSP,
  injected scripts can load remote payloads, exfiltrate data, and execute
  arbitrary code.
- **Fix:** Add CSP meta tag to the renderer's `index.html`:
  ```html
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
  ```
  Or set via `session.defaultSession.webRequest.onHeadersReceived`.

#### SEC-07: `shell: true` in Child Process Spawn

- **CWE:** CWE-78 (OS Command Injection)
- **OWASP:** A03 (Injection)
- **Location:** `src/cli/commands/gui.js:20`
- **Description:**
  ```javascript
  const child = spawn(cmd, args, {
      cwd: project_root,
      stdio: 'inherit',
      shell: true,
      detached: !opts.dev,
  })
  ```
- **Impact:** `shell: true` passes the command through the system shell,
  enabling shell metacharacter interpretation. While `cmd` and `args` are
  currently hardcoded, this is unnecessary attack surface.
- **Fix:** Remove `shell: true` (or set to `false`). If shell features are
  needed for `npm` on Windows, use platform-specific handling:
  ```javascript
  shell: process.platform === 'win32'
  ```

---

### MEDIUM

#### SEC-08: No Input Validation on IPC Handlers

- **CWE:** CWE-20 (Improper Input Validation)
- **OWASP:** A03 (Injection)
- **Location:** `src/main/ipc-handlers.js:80-86, 111-116`
- **Description:** IPC handlers for `secrets:add` and `users:add` accept
  data from the renderer without validation. Fields like `app`, `env`, `key`,
  `username`, `email`, and `pubkey` are passed directly to storage.
- **Impact:** While SQL injection is prevented by parameterized queries, there
  is no validation of data types, lengths, or formats. Malformed input could
  cause unexpected behavior or database corruption.
- **Fix:** Validate all IPC inputs:
  ```javascript
  if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
      throw new Error('Invalid key')
  }
  ```

#### SEC-09: Unvalidated File Path in load Command

- **CWE:** CWE-22 (Path Traversal)
- **OWASP:** A01 (Broken Access Control)
- **Location:** `src/cli/commands/load.js` (file path from `--file` option)
- **Description:** The CLI `load` command reads a file path from user input
  without path traversal validation.
- **Impact:** A user running the CLI can read arbitrary files, though this is
  somewhat expected for a CLI tool where the user already has shell access.
  Risk is higher if the CLI is ever wrapped in a web service.
- **Fix:** For defense in depth, normalize and validate paths:
  ```javascript
  const resolved = path.resolve(opts.file)
  ```

#### SEC-10: Race Condition in API Module Cache

- **CWE:** CWE-362 (Race Condition)
- **OWASP:** A04 (Insecure Design)
- **Location:** `src/core/api.js:36-39`
- **Description:** The global `_db`, `_key`, `_vault_dir` cache variables are
  not protected against concurrent access. If `get()` is called concurrently
  with different vault directories, state corruption is possible.
- **Impact:** In server environments with concurrent requests, one request
  could read secrets from another request's vault.
- **Fix:** Document that the API module is not thread-safe, or implement a
  mutex pattern for the cache.

#### SEC-11: Preload Fallback Bypasses Context Isolation

- **CWE:** CWE-693 (Protection Mechanism Failure)
- **OWASP:** A05 (Security Misconfiguration)
- **Location:** `src/preload/index.js:40-43`
- **Description:**
  ```javascript
  } else {
      window.electron = electronAPI
      window.api = api
  }
  ```
  If `contextIsolated` is false, the API is attached directly to the window
  object without any protection.
- **Impact:** Without context isolation, renderer scripts can access and
  tamper with the IPC bridge directly.
- **Fix:** Remove the fallback branch and always require context isolation.

#### SEC-12: Environment Variable Injection in Windows ACL Setup

- **CWE:** CWE-78 (OS Command Injection)
- **OWASP:** A03 (Injection)
- **Location:** `src/core/fileutils.js:71-82`
- **Description:** `USERDOMAIN` and `USERNAME` environment variables are used
  in `icacls` arguments. While `execFileSync` with array arguments prevents
  shell injection, spoofed environment variables could set incorrect ACLs.
- **Impact:** On shared systems, manipulated environment variables could grant
  vault access to the wrong user.
- **Fix:** Validate environment variable contents:
  ```javascript
  const username = (process.env.USERNAME || '').replace(/[^a-zA-Z0-9._-]/g, '')
  ```

---

### LOW

#### SEC-13: Plaintext Secrets Output to stdout

- **Location:** `src/cli/commands/get.js`
- **Description:** `console.log(secrets[0].get_value())` outputs plaintext
  secrets to stdout, potentially visible in terminal scrollback or logs.
- **Impact:** Expected behavior for a secrets CLI, but worth noting.
- **Fix:** Document that users should pipe to clipboard utilities.

#### SEC-14: No Audit Logging

- **Location:** `src/core/sqlite-storage.js`
- **Description:** No audit trail of who accessed, added, or removed secrets.
- **Impact:** Cannot detect unauthorized access or track changes.
- **Fix:** Add optional audit logging table.

#### SEC-15: Missing Input Length Limits

- **Location:** `src/cli/commands/add.js`, IPC handlers
- **Description:** No maximum length validation on secret values, usernames,
  or other fields.
- **Impact:** Extremely large inputs could cause memory issues.
- **Fix:** Enforce reasonable size limits.

#### SEC-16: Weak Auto-Generated Email

- **Location:** `src/cli/commands/init.js`, `src/main/ipc-handlers.js:291`
- **Description:** Email constructed as `${username}@${os.hostname()}` which
  may not be a valid email address.
- **Impact:** Cosmetic; no security impact.

---

### INFORMATIONAL

#### SEC-17: Custom Base64url Codec

- **Location:** `src/core/crypto/fernet.js:19-29`
- **Description:** Custom base64url implementation. Node.js 15.13+ supports
  `Buffer.toString('base64url')` natively.
- **Recommendation:** Consider using the built-in for reduced maintenance.

#### SEC-18: Dependency Version Ranges

- **Location:** `package.json`
- **Description:** Uses caret (`^`) ranges for dependencies including
  security-critical libraries like `tweetnacl` and `sql.js`.
- **Recommendation:** Pin exact versions for crypto libraries.

#### SEC-19: `.gitignore` Coverage

- **Status:** GOOD
- **Description:** `.gitignore` correctly excludes `.env`, `*.key`,
  `seeqrets.db`, and `seeqret/` directories.

---

## Summary Table

| Severity | Count | IDs                                    |
| -------- | ----- | -------------------------------------- |
| CRITICAL | 3     | SEC-01, SEC-02, SEC-03                 |
| HIGH     | 4     | SEC-04, SEC-05, SEC-06, SEC-07         |
| MEDIUM   | 5     | SEC-08, SEC-09, SEC-10, SEC-11, SEC-12 |
| LOW      | 4     | SEC-13, SEC-14, SEC-15, SEC-16         |
| INFO     | 3     | SEC-17, SEC-18, SEC-19                 |

## Positive Findings

These areas were reviewed and found to be well-implemented:

- **SQL parameterization**: All queries in `SqliteStorage` use parameterized
  statements (`?` placeholders with bind arrays). No SQL injection risk in the
  main storage layer.
- **No `Math.random` for crypto**: All randomness comes from Node.js `crypto`
  module.
- **No unsafe DOM manipulation**: No `innerHTML` or dynamic code execution
  patterns found in source.
- **No hardcoded secrets**: No API keys, passwords, or tokens found in source.
- **Proper Fernet implementation**: Correct AES-128-CBC + HMAC-SHA256 structure
  (aside from the timing issue in SEC-01).
- **NaCl via tweetnacl**: Uses well-tested library for X25519 + XSalsa20-Poly1305.
- **IPC uses `invoke`/`handle`**: Electron IPC follows the recommended
  request/response pattern rather than the less secure `send`/`on` pattern.

## Remediation Priority

### Immediate (before next release)
1. **SEC-01**: Switch to `crypto.timingSafeEqual()` in Fernet HMAC verification
2. **SEC-02**: Enable Electron sandbox
3. **SEC-03**: Remove private key exposure from IPC; keep crypto in main process
4. **SEC-04**: Set `mode: 0o600` on key file writes

### High Priority (within 2 sprints)
5. **SEC-05**: Add table name allowlist in migrations
6. **SEC-06**: Add CSP headers to Electron
7. **SEC-07**: Remove `shell: true` from gui.js spawn
8. **SEC-11**: Remove context isolation fallback in preload
9. Run `npm audit fix` for dependency vulnerabilities

### Medium Priority (within 1 quarter)
10. **SEC-08**: Add input validation to IPC handlers
11. **SEC-10**: Document or fix API cache thread-safety
12. **SEC-12**: Validate environment variables in ACL setup
