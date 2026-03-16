/**
 * Vault directory resolution and status.
 */

import os from 'os'
import fs from 'fs'
import path from 'path'

/**
 * Get the vault directory path. Prefers JSEEQRET, falls back to SEEQRET.
 * @returns {string}
 */
export function get_seeqret_dir() {
    if (process.env.JSEEQRET) {
        return process.env.JSEEQRET
    }

    if (process.env.SEEQRET) {
        return process.env.SEEQRET
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
    if (!process.env.JSEEQRET && !process.env.SEEQRET) return false

    const sdir = get_seeqret_dir()
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
