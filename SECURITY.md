# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | :white_check_mark: |
| < 0.5   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in jseeqret, **please do not open a public issue**.

Instead, report it privately by emailing the maintainer directly. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive an acknowledgement within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Model

jseeqret is a secrets manager that stores encrypted secrets in a local SQLite vault. The security model relies on:

### Encryption

- **Fernet encryption** (AES-128-CBC with HMAC-SHA256) for secret values, byte-compatible with Python's `cryptography.fernet.Fernet`
- **NaCl public-key encryption** (via `tweetnacl`) for key exchange between users
- Encryption keys are derived and stored per-user in the vault

### Vault Storage

- Secrets are stored in a local SQLite database (via `sql.js`, a pure WASM build)
- The vault file should be protected by filesystem permissions and should **not** be committed to version control
- The vault is compatible with Python [seeqret](https://github.com/thebjorn/seeqret) vaults

### Threat Model

jseeqret protects against:

- Secrets leaking into source code or version control
- Unauthorized reading of secret values at rest (encrypted in the vault)
- Accidental exposure of secrets in logs or CLI output

jseeqret does **not** protect against:

- An attacker with full access to the machine and user's files (the encryption keys are stored locally)
- Memory-based attacks on a running process
- Compromised dependencies in the supply chain

## Best Practices

- Keep the vault file (`seeqret.db`) out of version control (add to `.gitignore`)
- Restrict filesystem permissions on the vault directory
- Rotate secrets periodically
- Keep jseeqret and its dependencies up to date
- Audit access to machines where vaults are stored

## Dependencies

jseeqret uses the following security-relevant dependencies:

| Package | Purpose |
| --- | --- |
| Node.js `crypto` | AES-128-CBC, HMAC-SHA256, PBKDF2 (Fernet implementation) |
| `tweetnacl` | NaCl public-key cryptography (Curve25519, XSalsa20, Poly1305) |
| `sql.js` | SQLite via WASM (vault storage) |
