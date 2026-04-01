# Multi-Vault -- Implementation Plan

## Overview

Multi-vault adds a registry that maps human-readable vault names to directory paths, plus CLI/GUI support for switching between vaults. This is a foundational feature that [linked vault](../linked-vault/), [shared vault](../shared-vault/), and [vault hierarchy](../vault-hierarchy/) all build on.

## Phase 1: Vault Registry

### Goal
A persistent registry file that maps vault names to paths.

### Registry Location

The registry lives in the user's config directory:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\jseeqret\vaults.json` |
| Linux | `~/.config/jseeqret/vaults.json` |
| macOS | `~/Library/Application Support/jseeqret/vaults.json` |

Resolved at runtime using `process.env.APPDATA` (Windows) or `XDG_CONFIG_HOME` / `$HOME/.config` (Linux/macOS).

### Registry Format

```json
{
    "default": "work",
    "vaults": {
        "work": {
            "path": "C:\\Users\\bp\\.seeqret",
            "created_at": "2026-04-01T10:00:00Z",
            "last_used": "2026-04-01T14:30:00Z"
        },
        "personal": {
            "path": "C:\\Users\\bp\\personal-vault",
            "created_at": "2026-03-15T09:00:00Z",
            "last_used": "2026-03-31T18:00:00Z"
        },
        "server-prod": {
            "path": "\\\\server\\deploy\\.seeqret",
            "created_at": "2026-02-01T12:00:00Z",
            "last_used": "2026-03-28T11:00:00Z"
        }
    }
}
```

### Module Design

```
src/core/vault-registry.js
```

Public API:
- `get_registry_path()` -- returns the platform-specific path to `vaults.json`
- `load_registry()` -- reads and parses `vaults.json`, returns `{ default, vaults }`. Creates the file with empty state if it doesn't exist.
- `save_registry(registry)` -- writes `vaults.json` atomically (write to temp file, rename).
- `add_vault(name, path)` -- adds a vault entry. Validates that the path exists and contains `seeqrets.db`.
- `remove_vault(name)` -- removes a vault entry. Does not delete the vault directory.
- `get_vault_path(name)` -- resolves a vault name to a path. If name is null, returns the default vault's path.
- `set_default(name)` -- sets the default vault.
- `list_vaults()` -- returns all vault entries.

### Deliverables
- `src/core/vault-registry.js` module
- Tests for registry CRUD, default resolution, platform paths

## Phase 2: CLI Integration

### Goal
All CLI commands accept a `--vault <name>` option.

### Global Option

Add `--vault` as a global option on the Commander.js program:

```javascript
program.option('--vault <name>', 'vault to operate on (default: from registry)')
```

### Vault Resolution Order

When resolving which vault to use:

1. `--vault <name>` CLI option (highest priority)
2. `JSEEQRET` environment variable (existing behavior, preserved)
3. `SEEQRET` environment variable (Python compatibility)
4. Default vault from registry
5. `/srv/.seeqret` (fallback, existing default)

### New Commands

```powershell
# Register an existing vault
jseeqret vault add work --path "C:\Users\bp\.seeqret"

# Create a new vault and register it
jseeqret vault init personal --path "C:\Users\bp\personal-vault"

# List all registered vaults
jseeqret vault list

# Show details for a vault
jseeqret vault show work

# Set the default vault
jseeqret vault default work

# Remove a vault from the registry (does not delete files)
jseeqret vault remove old-project

# Use a specific vault with any command
jseeqret list --vault personal
jseeqret get DB_PASSWORD --app myapp --vault work
```

### Output Format

```
jseeqret vault list

  NAME           PATH                              DEFAULT
  work           C:\Users\bp\.seeqret              *
  personal       C:\Users\bp\personal-vault
  server-prod    \\server\deploy\.seeqret
```

### Deliverables
- `--vault` global option on the Commander.js program
- `src/cli/commands/vault.js` -- vault subcommands (add, init, list, show, default, remove)
- Updated `vault.js` to use registry resolution
- Tests for resolution order, CLI vault commands

## Phase 3: API Integration

### Goal
The library API can accept a vault name in addition to a path.

### Changes to `api.init()`

```javascript
// Existing: path-based (unchanged)
await init({ vault_dir: '/srv/.seeqret' })

// New: name-based (resolves via registry)
await init({ vault: 'work' })

// New: no arguments uses default vault from registry
await init()
```

### Changes to `vault.js`

`get_seeqret_dir()` gains an optional `vault_name` parameter:

```javascript
function get_seeqret_dir(vault_name = null) {
    if (vault_name) {
        return get_vault_path(vault_name)  // from registry
    }
    // existing resolution: env vars → default → /srv/.seeqret
}
```

### Deliverables
- Updated `api.init()` signature
- Updated `get_seeqret_dir()` to accept vault names
- Tests for name-based init, fallback behavior

## Phase 4: GUI Vault Picker

### Goal
The Electron app lets the user switch between vaults.

### Design

- **Vault selector** in the title bar or sidebar showing the current vault name.
- **Dropdown** listing all registered vaults with a visual indicator for the default.
- **Add vault** button opens a dialog to register or create a new vault.
- Switching vaults triggers a full reload of the secret list.

### IPC Handlers

```javascript
// In main process
ipcMain.handle('vault:list', () => list_vaults())
ipcMain.handle('vault:switch', (_, name) => { /* re-init with new vault */ })
ipcMain.handle('vault:add', (_, { name, path }) => add_vault(name, path))
ipcMain.handle('vault:remove', (_, name) => remove_vault(name))
ipcMain.handle('vault:set-default', (_, name) => set_default(name))
```

### Deliverables
- IPC handlers for vault registry operations
- Svelte vault picker component
- Vault add/create dialog with folder picker

## Migration Path

- **No breaking changes**. If `vaults.json` doesn't exist, jseeqret behaves exactly as it does today (env var → default path).
- The first time a user runs `jseeqret vault add`, the registry file is created.
- Existing `JSEEQRET` / `SEEQRET` environment variables continue to work and take precedence over the registry (unless `--vault` is specified).

## Open Questions

1. **Should `jseeqret init` auto-register?** When a user runs `jseeqret init` to create a new vault, should it automatically add an entry to the registry? Recommendation: yes, with a `--no-register` flag to opt out.
2. **Vault health checks**: Should `jseeqret vault list` verify that each registered vault's path still exists and the database is readable? Recommendation: yes, show a warning indicator for unreachable vaults.
3. **Registry locking**: If multiple processes (CLI + GUI) access the registry concurrently, writes could conflict. Use atomic file writes (temp + rename) and accept last-write-wins for the registry.
