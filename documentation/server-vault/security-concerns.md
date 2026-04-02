# Server Vault -- Security Concerns

## 1. File Watcher as a Code Injection Vector

**Risk**: High | **Category**: Integrity

The `api.watch()` mechanism uses `fs.watch()` on `seeqrets.db` to auto-reload secrets. If an attacker gains write access to the database file, the watcher automatically reloads attacker-controlled data into the running application. The application then serves attacker-supplied secret values (e.g., a database connection string pointing to an attacker's server, an API key that routes traffic through a proxy).

**Mitigation**:
- The vault directory must have strict filesystem permissions: writable only by the admin user, readable only by the web server process.
- On Linux: `chown admin:webserver /srv/.seeqret && chmod 750 /srv/.seeqret && chmod 640 /srv/.seeqret/seeqrets.db`.
- On Windows: NTFS ACLs restricting write to the admin account only.
- Consider adding a checksum verification step: after reloading, compute a hash of the database and compare against a known-good value stored separately.

## 2. Encrypted Export Files in Shared Directories

**Risk**: Medium | **Category**: Data exposure

The file-based push workflow writes NaCl-encrypted files to shared directories. These files persist until explicitly deleted. Even though the content is encrypted:
- The file's existence reveals that a secret update happened (timing metadata).
- Cloud provider backups may retain copies indefinitely.
- If the recipient's private key is later compromised, all historical encrypted exports become readable (no forward secrecy).

**Mitigation**: Auto-delete encrypted files after successful import (as noted in the plan). Set a maximum age for unprocessed files in the shared directory (e.g., 24 hours). Consider ephemeral Diffie-Hellman key exchange for forward secrecy in future versions.

## 3. SSH-Based Remote Administration

**Risk**: Medium | **Category**: Authentication/Authorization

Phase 2 wraps `ssh + export/import` for remote administration. This inherits all SSH security properties but also its risks:
- SSH key compromise grants full vault admin access.
- If the admin's SSH key has no passphrase, anyone with access to the admin's machine can push arbitrary secrets to the server.
- SSH agent forwarding on intermediate hosts could expose the key.

**Mitigation**: Document that SSH keys used for vault administration should have passphrases. Recommend using dedicated SSH keys (not the user's general-purpose key) for vault operations. Consider adding a second factor -- e.g., the push command could require confirming the operation by verifying a NaCl signature.

## 4. `reload()` During Active Requests

**Risk**: Medium | **Category**: Consistency/Availability

When `api.reload()` is triggered (by file watcher or signal), the in-memory secret cache is replaced. If a web server is handling a request that reads multiple secrets, a reload between reads could give the request a mix of old and new values -- for example, a new database password but an old database hostname.

**Mitigation**: Implement atomic reload: build the complete new state before swapping. Use a snapshot pattern where the old cache remains valid for in-flight requests while new requests use the new cache. The plan mentions atomic swap -- ensure this is the implementation.

## 5. Debounce Window Hides Rapid Changes

**Risk**: Low | **Category**: Integrity

The 500ms debounce on `fs.watch()` events means that if an attacker writes to the database and then immediately writes again (to revert), the application may only see one of the two changes. This could be used to briefly inject a malicious value and then revert, making forensic detection harder.

**Mitigation**: Log every reload event (before and after state) to enable forensic analysis. The debounce is acceptable for normal operation but should not suppress logging.

## 6. Process Isolation Between Admin and Web Server

**Risk**: High | **Category**: Privilege separation

The plan notes that the vault directory must be writable by the admin and readable by the web server. In practice, this means:
- If both processes run as the same user (common in simple deployments), there is no privilege separation.
- If the web server process is compromised, the attacker can read all secrets (including those the application doesn't use) and potentially all key files.

**Mitigation**: Recommend separate OS users for admin and web server processes. The web server user should have read-only access to `seeqrets.db` and `seeqret.key`, and no access to `private.key` (which is only needed for transit encryption, not runtime reads). Document this as a deployment best practice.

## 7. Vault Service Sketch (Phase 4) -- Authentication Concerns

**Risk**: Medium | **Category**: Future design

The Phase 4 sketch describes NaCl challenge-response authentication for the HTTP service. Key concerns:
- The challenge-response must use a fresh nonce to prevent replay attacks.
- Session tokens issued after authentication need expiration and revocation.
- The service binds to localhost by default -- if changed to `0.0.0.0`, it's exposed to the network without TLS.
- No rate limiting is mentioned for authentication attempts.

**Mitigation**: When the vault service is implemented, require TLS for non-localhost bindings, implement rate limiting on `/auth/challenge`, and use short-lived session tokens (e.g., 15 minutes) with explicit revocation on logout.

## 8. SIGHUP Signal Handling (Linux)

**Risk**: Low | **Category**: Denial of service

Option B uses `SIGHUP` to trigger reload. Any process running as the same user (or root) can send `SIGHUP` to the web server, forcing a reload. This is a minor DoS risk -- rapid SIGHUP signals could cause excessive disk reads.

**Mitigation**: Debounce signal-triggered reloads the same way as file watcher reloads. This is a Unix convention and the risk is low -- any process that can send signals can also kill the process.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | File watcher reloads attacker data | High | Strict filesystem permissions, document setup |
| 2 | Encrypted exports persist | Medium | Auto-delete after import |
| 3 | SSH key compromise = vault admin | Medium | Dedicated keys with passphrases |
| 4 | Non-atomic reload mid-request | Medium | Implement snapshot-based atomic swap |
| 5 | Debounce hides rapid changes | Low | Log every reload event |
| 6 | No privilege separation | High | Document separate OS users |
| 7 | Vault service auth gaps | Medium | Address when service is built |
| 8 | SIGHUP DoS | Low | Debounce signal reloads |
