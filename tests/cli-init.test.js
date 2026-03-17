import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { run_command, cleanup_vault } from './cli-helpers.js'

let tmp_dir

afterEach(() => {
    if (tmp_dir) {
        cleanup_vault(tmp_dir)
        tmp_dir = null
    }
})

describe('CLI: init', () => {
    it('creates vault directory and files', () => {
        tmp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'jseeqret-cli-init-')
        )
        const result = run_command([
            'init', tmp_dir,
            '--user', 'alice',
            '--email', 'alice@test.com',
        ], { env: { TESTING: 'TRUE' } })

        expect(result.exit_code).toBe(0)

        const vault_dir = path.join(tmp_dir, 'seeqret')
        expect(fs.existsSync(vault_dir)).toBe(true)
        expect(
            fs.existsSync(path.join(vault_dir, 'seeqrets.db'))
        ).toBe(true)
        expect(
            fs.existsSync(path.join(vault_dir, 'seeqret.key'))
        ).toBe(true)
        expect(
            fs.existsSync(path.join(vault_dir, 'public.key'))
        ).toBe(true)
        expect(
            fs.existsSync(path.join(vault_dir, 'private.key'))
        ).toBe(true)

        // Set tmp_dir to vault_dir for cleanup
        tmp_dir = tmp_dir
    })

    it('prints JSEEQRET env instructions', () => {
        tmp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'jseeqret-cli-init-')
        )
        const result = run_command([
            'init', tmp_dir,
            '--user', 'alice',
            '--email', 'alice@test.com',
        ], { env: { TESTING: 'TRUE' } })

        expect(result.stdout).toContain('Vault initialized')
        expect(result.stdout).toContain('JSEEQRET')
    })

    it('fails if parent directory does not exist', () => {
        const result = run_command([
            'init', '/nonexistent/path/12345',
            '--user', 'alice',
            '--email', 'alice@test.com',
        ], { env: { TESTING: 'TRUE' } })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('must exist')
    })

    it('accepts --key for existing symmetric key', () => {
        tmp_dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'jseeqret-cli-init-')
        )
        const custom_key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

        const result = run_command([
            'init', tmp_dir,
            '--user', 'alice',
            '--email', 'alice@test.com',
            '--key', custom_key,
        ], { env: { TESTING: 'TRUE' } })

        expect(result.exit_code).toBe(0)
        const vault_dir = path.join(tmp_dir, 'seeqret')
        const saved_key = fs.readFileSync(
            path.join(vault_dir, 'seeqret.key'), 'utf-8',
        )
        expect(saved_key).toBe(custom_key)
    })
})
