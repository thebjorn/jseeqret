/**
 * File system utilities for vault hardening.
 *
 * Provides Windows NTFS encryption (EFS) and permission management.
 */

import { execFileSync } from 'child_process'

/**
 * Run a command with arguments and return trimmed stdout.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function run(cmd, args) {
    try {
        return execFileSync(cmd, args, {
            stdio: 'pipe', encoding: 'utf-8',
        }).trim()
    } catch {
        return ''
    }
}

/**
 * Check if a command is available on the system.
 * @param {string} name - command name (e.g. 'cipher')
 * @returns {boolean}
 */
function has_command(name) {
    return run('where', [name]).endsWith(`${name}.exe`)
}

/**
 * Run the attrib command to query or set file attributes.
 * @param {string} dir_path
 * @param {string} [flag] - optional attribute flag (e.g. '+I')
 * @returns {string}
 */
export function attrib_cmd(dir_path, flag = '') {
    const args = flag ? [flag, dir_path] : [dir_path]
    return run('attrib', args)
}

/**
 * Check if a directory is encrypted with Windows EFS.
 * @param {string} dirname
 * @returns {boolean}
 */
export function is_encrypted(dirname) {
    if (process.platform !== 'win32') return false
    const output = run('cipher', ['/c', dirname])
    return output.includes(`E ${dirname}`)
        || output.includes('E  ')
}

/**
 * Harden the vault directory on Windows with NTFS permissions
 * and EFS encryption. Skipped when TESTING env var is set.
 * @param {string} vault_dir - full path to vault directory
 */
export function harden_vault_windows(vault_dir) {
    if (process.platform !== 'win32') return
    if (process.env.TESTING === 'TRUE') return

    const have_icacls = has_command('icacls')
    const have_cipher = has_command('cipher')

    // Restrict permissions to current user only
    if (have_icacls) {
        const domain = process.env.USERDOMAIN || ''
        const username = process.env.USERNAME || ''
        const current_user = domain
            ? `${domain}\\${username}`
            : username

        if (current_user) {
            run('icacls', [
                vault_dir, '/grant',
                `${current_user}:(F)`,
            ])
            run('icacls', [vault_dir, '/inheritance:r'])
        }
    }

    // Exclude from Windows search indexing
    const attrs = attrib_cmd(vault_dir)
    if (!attrs.includes('I')) {
        attrib_cmd(vault_dir, '+I')
    }

    // Encrypt with EFS
    if (have_cipher && !is_encrypted(vault_dir)) {
        run('cipher', ['/e', vault_dir])
    }
}
