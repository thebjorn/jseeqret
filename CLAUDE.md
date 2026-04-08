# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jseeqret is a JavaScript port of Python's `seeqret` secrets manager with full compatibility (same database, encryption keys, and formats). It provides three interfaces: a CLI (Commander.js), an Electron GUI (Svelte 5), and a Node.js library API. Uses ESM (`"type": "module"`).

## Commands

```bash
pnpm dev               # Electron dev server with hot reload
pnpm build             # Production build (electron-vite)
pnpm test              # Run all tests (vitest)
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report (v8, covers src/core/**)
pnpm cli               # Run CLI directly: node ./src/cli/index.js
pnpm bench             # Performance benchmark (get operations/sec)
pnpm docs:build         # Generate JSDoc docs
```

Run a single test file: `pnpm exec vitest run tests/api.test.js`

## Architecture

### Three-layer design

- **`src/core/`** — Shared library (also the npm package export). Contains all business logic: encryption, storage, models, serializers, API. This is what tests cover.
- **`src/cli/`** — CLI built on Commander.js. Each command is a separate file in `commands/`. Entry point: `src/cli/index.js`.
- **`src/main/` + `src/preload/` + `src/renderer/`** — Electron app. Main process handles IPC, preload bridges via `contextBridge`, renderer uses Svelte 5 with runes (`$state`, `$effect`, `$props`).

### Core modules

- `api.js` — Public async/sync API (`get`, `get_sync`, `init`, `close`)
- `sqlite-storage.js` — `SqliteStorage` class, all CRUD via sql.js (pure JS/WASM SQLite, no native bindings)
- `crypto/fernet.js` — Fernet encryption (AES-128-CBC + HMAC-SHA256) for secrets at rest
- `crypto/nacl.js` — NaCl (X25519 + XSalsa20-Poly1305) for transit encryption
- `models/secret.js` — `Secret` class with encrypt/decrypt
- `models/user.js` — `User` class with public key management
- `filter.js` — `FilterSpec` for glob-pattern matching (`app:env:*`)
- `vault.js` — Vault directory resolution (env var `JSEEQRET` or `SEEQRET`, default `/srv/.seeqret`)
- `migrations.js` — Database schema migrations
- `serializers/` — Output format handlers (env, json-crypt, backup, command)

### Vault structure

The vault directory contains: `seeqrets.db` (SQLite), `seeqret.key` (symmetric), `public.key` and `private.key` (asymmetric). All keys are base64-encoded plaintext files.

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately – don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between master and/or development branches and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes – don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests – then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Code Style (see STYLEGUIDE.md)

- **snake_case** for functions and variables, **PascalCase** for classes, **UPPER_SNAKE_CASE** for constants, **kebab-case** for files
- 4 spaces indentation, max 79 chars (up to 100 if needed)
- Single quotes, no semicolons (except on return statements)
- HTML void elements: no closing solidus (`<br>` not `<br/>`)
- Repeated patterns should stay visually similar even if it breaks line length
- Imports: group by standard library, third-party, local; use single quotes

## Testing

Tests live in `tests/` and cover `src/core/` only. Each test creates a temporary vault directory and cleans up in `afterEach`. Test globals (`describe`, `it`, `expect`) are enabled via vitest config.

## Python Compatibility

This project must stay compatible with the Python `seeqret` tool. The database format, encryption schemes (Fernet and NaCl), key files, and CLI command structure all mirror the Python version.
