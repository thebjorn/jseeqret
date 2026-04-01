/**
 * Vault directory resolution and status.
 */

import os from 'os'
import fs from 'fs'
import path from 'path'
import { registry_resolve, registry_default } from './vault-registry.js'

/**
 * Check if a string looks like an absolute path (not a vault name).
 * @param {string} value
 * @returns {boolean}
 */
function is_path(value) {
    return path.isAbsolute(value) || value.startsWith('.')
        || value.includes('/') || value.includes('\\')
}

/**
 * Get the vault directory path.
 *
 * Resolution order:
 *   1. JSEEQRET env var — absolute path returned as-is, otherwise
 *      treated as a vault name and looked up in the registry.
 *   2. SEEQRET env var — same logic.
 *   3. Registry default (set via `vault use <name>`).
 *   4. Linux fallback: /srv/.seeqret
 *
 * @returns {string}
 */
export function get_seeqret_dir() {
    for (const env_key of ['JSEEQRET', 'SEEQRET']) {
        const value = process.env[env_key]
        if (!value) continue

        if (is_path(value)) return value

        // Non-path value → treat as vault name
        const resolved = registry_resolve(value)
        if (resolved) return resolved

        throw new Error(
            `Vault name "${value}" (from ${env_key}) not found in registry`
        )
    }

    // No env var — check registry default
    const default_name = registry_default()
    if (default_name) {
        const resolved = registry_resolve(default_name)
        if (resolved) return resolved
    }

    if (process.platform !== 'win32') {
        return '/srv/.seeqret'
    }

    throw new Error('JSEEQRET (or SEEQRET) environment variable is not set')
}

/**
 * Check if the vault is initialized.
 * @returns {boolean}
 */
export function is_initialized() {
    let sdir
    try {
        sdir = get_seeqret_dir()
    } catch {
        return false
    }

    if (!fs.existsSync(sdir)) return false
    if (!fs.existsSync(path.join(sdir, 'seeqrets.db'))) return false

    return true
}

/**
 * Get the current OS username.
 * @returns {string}
 */
export function current_user() {
    return os.userInfo().username
}
