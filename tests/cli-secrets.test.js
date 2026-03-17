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

describe('CLI: add key', () => {
    it('adds a secret with defaults', () => {
        const result = run_command([
            'add', 'key', 'API_KEY', 'secret123',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Added secret')
        expect(result.stdout).toContain('*:*:API_KEY')
    })

    it('adds a secret with app and env', () => {
        const result = run_command([
            'add', 'key', 'DB_PASS', 's3cret',
            '--app', 'myapp', '--env', 'prod',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('myapp:prod:DB_PASS')
    })

    it('adds a secret with int type', () => {
        run_command([
            'add', 'key', 'PORT', '5432',
            '--app', 'myapp', '--env', 'prod',
            '--type', 'int',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'get', 'myapp:prod:PORT',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout.trim()).toBe('5432')
    })
})

describe('CLI: add text', () => {
    it('adds a multi-line secret from stdin', () => {
        const multi_line = 'line1\nline2\nline3'
        const result = run_command([
            'add', 'text', 'CERT',
        ], { vault_dir: tmp_dir, input: multi_line })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Added secret')

        const get_result = run_command([
            'get', 'CERT',
        ], { vault_dir: tmp_dir })

        expect(get_result.stdout.trim()).toBe(multi_line)
    })

    it('fails if secret already exists', () => {
        run_command([
            'add', 'key', 'EXISTING', 'val',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'add', 'text', 'EXISTING',
        ], { vault_dir: tmp_dir, input: 'new value' })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('already exists')
    })

    it('accepts app and env options', () => {
        const result = run_command([
            'add', 'text', 'NOTES',
            '--app', 'myapp', '--env', 'dev',
        ], { vault_dir: tmp_dir, input: 'some notes' })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('myapp:dev:NOTES')
    })
})

describe('CLI: add user', () => {
    it('adds a user', () => {
        const result = run_command([
            'add', 'user',
            '--username', 'bob',
            '--email', 'bob@test.com',
            '--pubkey', 'fakepubkey123',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Added user: bob')
    })
})

describe('CLI: list', () => {
    it('lists secrets', () => {
        run_command([
            'add', 'key', 'A_KEY', 'val1',
            '--app', 'app1', '--env', 'dev',
        ], { vault_dir: tmp_dir })
        run_command([
            'add', 'key', 'B_KEY', 'val2',
            '--app', 'app1', '--env', 'prod',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'list',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('A_KEY')
        expect(result.stdout).toContain('B_KEY')
    })

    it('filters by filter spec', () => {
        run_command([
            'add', 'key', 'A_KEY', 'val1',
            '--app', 'app1', '--env', 'dev',
        ], { vault_dir: tmp_dir })
        run_command([
            'add', 'key', 'B_KEY', 'val2',
            '--app', 'app2', '--env', 'prod',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'list', '-f', 'app1:*:*',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('A_KEY')
        expect(result.stdout).not.toContain('B_KEY')
    })

    it('shows message when no secrets found', () => {
        const result = run_command([
            'list',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('No matching secrets')
    })
})

describe('CLI: get', () => {
    it('gets a secret value', () => {
        run_command([
            'add', 'key', 'MY_SECRET', 'hello',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'get', 'MY_SECRET',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout.trim()).toBe('hello')
    })

    it('fails when no secret found', () => {
        const result = run_command([
            'get', 'NONEXISTENT',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('No secrets found')
    })

    it('fails when multiple secrets match', () => {
        run_command([
            'add', 'key', 'SAME', 'v1',
            '--app', 'a1', '--env', 'e1',
        ], { vault_dir: tmp_dir })
        run_command([
            'add', 'key', 'SAME', 'v2',
            '--app', 'a2', '--env', 'e2',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'get', '*:*:SAME',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('Found 2')
    })
})

describe('CLI: edit value', () => {
    it('updates a secret value', () => {
        run_command([
            'add', 'key', 'EDITABLE', 'old_val',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'edit', 'value', 'EDITABLE', 'new_val',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Updated 1')

        const get_result = run_command([
            'get', 'EDITABLE',
        ], { vault_dir: tmp_dir })
        expect(get_result.stdout.trim()).toBe('new_val')
    })

    it('fails when no secret matches', () => {
        const result = run_command([
            'edit', 'value', 'NOPE', 'val',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('No secrets found')
    })

    it('requires --all for multiple matches', () => {
        run_command([
            'add', 'key', 'DUP', 'v1',
            '--app', 'a1', '--env', 'e1',
        ], { vault_dir: tmp_dir })
        run_command([
            'add', 'key', 'DUP', 'v2',
            '--app', 'a2', '--env', 'e2',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'edit', 'value', '*:*:DUP', 'new_val',
        ], { vault_dir: tmp_dir })
        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('--all')

        const all_result = run_command([
            'edit', 'value', '*:*:DUP', 'new_val', '--all',
        ], { vault_dir: tmp_dir })
        expect(all_result.exit_code).toBe(0)
        expect(all_result.stdout).toContain('Updated 2')
    })
})

describe('CLI: rm key', () => {
    it('removes a secret', () => {
        run_command([
            'add', 'key', 'TO_DELETE', 'val',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'rm', 'key', 'TO_DELETE',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Removed 1')

        const get_result = run_command([
            'get', 'TO_DELETE',
        ], { vault_dir: tmp_dir })
        expect(get_result.exit_code).not.toBe(0)
    })

    it('shows message when no secrets match', () => {
        const result = run_command([
            'rm', 'key', 'NOTHING',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('No matching')
    })
})
