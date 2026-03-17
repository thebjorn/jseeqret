import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    create_test_vault, cleanup_vault, run_command,
} from './cli-helpers.js'

let tmp_dir

beforeEach(async () => {
    const vault = await create_test_vault()
    tmp_dir = vault.tmp_dir
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: users', () => {
    it('lists the admin user', () => {
        const result = run_command([
            'users',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('testuser')
    })

    it('lists multiple users', () => {
        run_command([
            'add', 'user',
            '--username', 'alice',
            '--email', 'alice@test.com',
            '--pubkey', 'pk1',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'users',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('testuser')
        expect(result.stdout).toContain('alice')
    })

    it('exports users as add commands', () => {
        const result = run_command([
            'users', '--export',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain(
            'jseeqret add user --username testuser'
        )
        expect(result.stdout).toContain('--email test@test.com')
    })
})

describe('CLI: owner', () => {
    it('shows the vault owner', () => {
        const result = run_command([
            'owner',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('testuser')
        expect(result.stdout).toContain('test@test.com')
    })
})

describe('CLI: whoami', () => {
    it('identifies current user', () => {
        const result = run_command([
            'whoami',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        // Output will contain the OS username
        expect(result.stdout.trim().length).toBeGreaterThan(0)
    })
})

describe('CLI: keys', () => {
    it('displays admin keys', () => {
        const result = run_command([
            'keys',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        // Keys should be base64 strings present in output
        expect(result.stdout.length).toBeGreaterThan(20)
    })
})
