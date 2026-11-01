# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

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
- Keys are generated randomly per vault by `jseeqret init` (the Fernet key in `seeqret.key`, the NaCl key pair in `public.key`/`private.key`) and stored in the vault directory
- `jseeqret backup` encrypts the whole vault into a self-decrypting HTML file with AES-256-GCM, using a key derived from your password with PBKDF2-SHA256 (600,000 iterations)
- The optional Slack exchange carries only NaCl-encrypted envelopes; see `docs-src/slack-exchange.md` for its security model

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

- Keep the vault database (`seeqrets.db`) and key files out of version control (add them to `.gitignore`)
- Restrict filesystem permissions on the vault directory
- Rotate secrets periodically
- Keep jseeqret and its dependencies up to date
- Audit access to machines where vaults are stored

## Dependencies

jseeqret uses the following security-relevant dependencies:

| Package | Purpose |
| --- | --- |
| Node.js `crypto` | AES-128-CBC, HMAC-SHA256 (Fernet implementation) |
| Web Crypto (in the backup HTML) | PBKDF2-SHA256 + AES-256-GCM (password-protected backup) |
| `tweetnacl` | NaCl public-key cryptography (Curve25519, XSalsa20, Poly1305) |
| `sql.js` | SQLite via WASM (vault storage) |
| `@slack/web-api` | Slack exchange transport (holds the Slack user token) |
