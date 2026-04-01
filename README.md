# jseeqret

![cicd](https://github.com/thebjorn/jseeqret/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/thebjorn/jseeqret/graph/badge.svg?token=5PQOZLTSYD)](https://codecov.io/gh/thebjorn/jseeqret)
[![downloads](https://img.shields.io/npm/dt/jseeqret)](https://www.npmjs.com/package/jseeqret)
[![Socket Badge](https://socket.dev/api/badge/npm/package/jseeqret/0.1.0)](https://socket.dev/npm/package/jseeqret/overview/0.1.0)

<!-- <a href="https://github.com/thebjorn/jseeqret"><img src="docs/github-mark/github-mark.png" width="25" height="25"></a> -->

JavaScript/Electron/Svelte 5 port of [seeqret](https://github.com/thebjorn/seeqret) - a secure secrets manager.

**Fully compatible** with Python seeqret vaults - reads and writes the same database, encryption keys, and formats.

## Setup

```bash
npm install
```

## CLI Usage

```bash
# Initialize a new vault
node src/cli/index.js init . --user myuser --email user@example.com

# Add a secret
node src/cli/index.js add key DB_PASSWORD "s3cret" --app myapp --env prod

# List secrets
node src/cli/index.js list
node src/cli/index.js list -f "myapp:prod:*"

# Get a secret value
node src/cli/index.js get "myapp:prod:DB_PASSWORD"

# Edit a secret
node src/cli/index.js edit value "myapp:prod:DB_PASSWORD" "new-value"

# Remove a secret
node src/cli/index.js rm key "myapp:prod:DB_PASSWORD"

# User management
node src/cli/index.js users
node src/cli/index.js owner
node src/cli/index.js whoami
node src/cli/index.js keys
```

## Electron GUI

```bash
npm run dev
```

## Architecture

- `src/core/` - Shared library (crypto, storage, models, filter)
- `src/cli/` - CLI interface (Commander.js)
- `src/main/` - Electron main process
- `src/preload/` - Electron preload (IPC bridge)
- `src/renderer/` - Svelte 5 UI

## Encryption Compatibility

- **At rest**: Fernet (AES-128-CBC + HMAC-SHA256) - identical to Python `cryptography.fernet`
- **In transit**: X25519 + XSalsa20-Poly1305 via tweetnacl - compatible with PyNaCl
- **Signing**: SHA-256

## Dependencies

- `sql.js` - Pure JS SQLite (WASM)
- `tweetnacl` / `tweetnacl-util` - NaCl crypto
- `commander` - CLI framework
- `cli-table3` - Terminal tables
- `electron-vite` - Electron + Vite + Svelte 5
