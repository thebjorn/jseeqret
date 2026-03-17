/**
 * Test helpers for CLI command testing.
 *
 * Provides a run_command() function that executes CLI commands
 * in a subprocess with proper vault isolation.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { run_migrations } from '../src/core/migrations.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

const CLI_PATH = path.resolve('src/cli/index.js')

/**
 * Create a temporary vault directory with keys and database.
 * @returns {{ tmp_dir: string, pubkey: string }}
 */
export async function create_test_vault() {
    const tmp_dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'jseeqret-cli-test-')
    )
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    const pubkey = encode_key(key_pair.publicKey)
    await run_migrations(
        tmp_dir, 'testuser', 'test@test.com', pubkey,
    )
    return { tmp_dir, pubkey }
}

/**
 * Clean up a temporary vault directory.
 * @param {string} tmp_dir
 */
export function cleanup_vault(tmp_dir) {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
}

/**
 * Run a jseeqret CLI command in a subprocess.
 * @param {string[]} args - command arguments
 * @param {object} [options]
 * @param {string} [options.vault_dir] - vault directory
 * @param {string} [options.cwd] - working directory
 * @param {string} [options.input] - stdin input
 * @param {object} [options.env] - extra env vars
 * @returns {{ stdout: string, stderr: string, exit_code: number }}
 */
export function run_command(args, options = {}) {
    const env = {
        ...process.env,
        TESTING: 'TRUE',
        ...(options.env || {}),
    }
    if (options.vault_dir) {
        env.JSEEQRET = options.vault_dir
    }

    try {
        const stdout = execFileSync('node', [CLI_PATH, ...args], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.cwd || process.cwd(),
            env,
            input: options.input,
            timeout: 10000,
        })
        return { stdout, stderr: '', exit_code: 0 }
    } catch (e) {
        return {
            stdout: e.stdout || '',
            stderr: e.stderr || '',
            exit_code: e.status || 1,
        }
    }
}
