# Multi-Vault -- Security Concerns

## 1. Registry File Contains Vault Locations

**Risk**: Medium | **Category**: Information disclosure

`vaults.json` is a plaintext JSON file in the user's config directory (`%APPDATA%\jseeqret\` on Windows). It maps vault names to filesystem paths, including UNC paths to network shares. An attacker who reads this file learns:
- How many vaults exist and their names (revealing organizational structure).
- Exact filesystem paths to every vault (enabling targeted attacks on vault directories).
- Which vault is the default (likely the most important one).
- Network share paths that reveal server names and share structures.

**Mitigation**: The registry file should have restrictive filesystem permissions (owner-only read/write). On Windows, set NTFS ACLs during creation. Consider whether vault paths in the registry should be obfuscated (though this is security-by-obscurity and of limited value).

## 2. Registry File Is Not Integrity-Protected

**Risk**: Medium | **Category**: Integrity/Misdirection

An attacker with write access to `vaults.json` could redirect a vault name to a different directory containing an attacker-controlled database with malicious secret values. For example, changing the `work` vault path to point to a fake vault would cause the user to unknowingly read attacker-supplied secrets.

**Mitigation**: The registry should be checked against the vault's identity (vault_id from the vault_meta table, when available). If the vault at the registered path has a different identity than expected, warn the user. Consider signing the registry file or storing a hash of each vault's identity alongside the path.

## 3. `--vault` Option Overrides All Safety

**Risk**: Low | **Category**: Operational

The `--vault <name>` CLI option takes highest priority in vault resolution. A script or alias that injects `--vault malicious-vault` into a command could redirect operations to an unintended vault. In shared environments (CI/CD, shared servers), this could be exploited.

**Mitigation**: Log which vault is being used at the start of every CLI operation. In CI/CD contexts, recommend using explicit vault paths via environment variables rather than names that can be redirected.

## 4. Vault Registry Race Conditions

**Risk**: Low | **Category**: Integrity

Multiple processes (CLI invocations, Electron GUI) may read and write `vaults.json` concurrently. The plan uses atomic file writes (temp + rename), which is good. However, on Windows, `rename` is not always atomic on network-mapped drives, and NTFS has edge cases with antivirus software holding file handles.

**Mitigation**: The atomic write pattern (write to temp, rename) is sufficient for the common case. For network drives, consider advisory locking. Accept last-write-wins for registry conflicts -- the registry is metadata, not secrets.

## 5. Vault Path Validation Gaps

**Risk**: Medium | **Category**: Injection

`add_vault(name, path)` validates that the path exists and contains `seeqrets.db`. However:
- The name is user-provided and could contain special characters that cause issues in filesystem operations or command injection if used in shell commands.
- The path could be a symlink pointing to an unintended location.
- On Windows, paths like `\\?\` prefix or device paths (`CON`, `NUL`) could cause unexpected behavior.

**Mitigation**: Sanitize vault names to alphanumeric plus hyphens/underscores. Resolve symlinks with `fs.realpathSync()` before storing. Reject Windows device names and `\\?\` prefix paths.

## 6. Default Vault as Implicit Target

**Risk**: Low | **Category**: Operational security

When `--vault` is omitted and no environment variable is set, the default vault is used. If a user forgets they changed the default (e.g., to a test vault), they may inadvertently write production secrets to a test vault or read test secrets thinking they're production values.

**Mitigation**: Display the active vault name in CLI output headers and in the Electron GUI title bar (as planned). Consider a visual distinction (color, icon) for non-default vaults.

## Summary

| # | Concern | Risk | Action Required |
|---|---------|------|-----------------|
| 1 | Registry reveals vault locations | Medium | Restrict file permissions on creation |
| 2 | Registry can redirect to fake vault | Medium | Cross-check vault identity on access |
| 3 | `--vault` override in shared envs | Low | Log active vault in CLI output |
| 4 | Concurrent registry writes | Low | Atomic writes are sufficient |
| 5 | Name/path injection | Medium | Sanitize names, resolve symlinks |
| 6 | Default vault confusion | Low | Display active vault prominently |
