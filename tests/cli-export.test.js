import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    create_test_vault, cleanup_vault, run_command,
} from './cli-helpers.js'
import {
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(async () => {
    const vault = await create_test_vault()
    tmp_dir = vault.tmp_dir

    // Add a second user for export/load testing
    const key_pair = generate_and_save_key_pair(
        fs.mkdtempSync(
            path.join(os.tmpdir(), 'jseeqret-bob-')
        )
    )
    const bob_pubkey = encode_key(key_pair.publicKey)

    run_command([
        'add', 'user',
        '--username', 'bob',
        '--email', 'bob@test.com',
        '--pubkey', bob_pubkey,
    ], { vault_dir: tmp_dir })

    // Add test secrets
    run_command([
        'add', 'key', 'SECRET_A', 'value_a',
        '--app', 'myapp', '--env', 'prod',
    ], { vault_dir: tmp_dir })
    run_command([
        'add', 'key', 'SECRET_B', 'value_b',
        '--app', 'myapp', '--env', 'dev',
    ], { vault_dir: tmp_dir })
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: export', () => {
    it('exports secrets as json-crypt', () => {
        const result = run_command([
            'export', '--to', 'bob',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        const payload = JSON.parse(result.stdout)
        expect(payload.from).toBe('testuser')
        expect(payload.to).toBe('bob')
        expect(payload.secrets).toHaveLength(2)
        expect(payload.version).toBe(1)
    })

    it('exports with filter', () => {
        const result = run_command([
            'export', '--to', 'bob',
            '-f', 'myapp:prod:*',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        const payload = JSON.parse(result.stdout)
        expect(payload.secrets).toHaveLength(1)
    })

    it('exports to file with -o', () => {
        const out_path = path.join(tmp_dir, 'export.json')
        const result = run_command([
            'export', '--to', 'bob',
            '-o', out_path,
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(fs.existsSync(out_path)).toBe(true)

        const payload = JSON.parse(
            fs.readFileSync(out_path, 'utf-8')
        )
        expect(payload.secrets).toHaveLength(2)
    })

    it('fails when user not found', () => {
        const result = run_command([
            'export', '--to', 'nobody',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('not found')
    })

    it('fails when no secrets match', () => {
        const result = run_command([
            'export', '--to', 'bob',
            '-f', 'nonexistent:*:*',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).not.toBe(0)
        expect(result.stderr).toContain('No matching')
    })

    it('exports with command serializer', () => {
        const result = run_command([
            'export', '--to', 'bob',
            '-s', 'command',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('jseeqret load')
        expect(result.stdout).toContain('-scommand')
    })

    it('exports with backup serializer', () => {
        const result = run_command([
            'export', '--to', 'bob',
            '-s', 'backup',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        const payload = JSON.parse(result.stdout)
        expect(payload.secrets[0].value).toBe('value_a')
    })
})

describe('CLI: backup', () => {
    it('exports all secrets as plaintext JSON', () => {
        const result = run_command([
            'backup',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        const payload = JSON.parse(result.stdout)
        expect(payload.secrets).toHaveLength(2)
        expect(payload.secrets[0].value).toBeDefined()
    })
})

describe('CLI: load', () => {
    it('loads secrets from backup file', () => {
        // Export as backup
        const out_path = path.join(tmp_dir, 'backup.json')
        run_command([
            'export', '--to', 'bob',
            '-s', 'backup',
            '-o', out_path,
        ], { vault_dir: tmp_dir })

        // Create a fresh vault for bob
        const bob_vault = create_bob_vault()

        const result = run_command([
            'load', '-f', out_path, '-s', 'backup',
        ], { vault_dir: bob_vault })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('Imported 2')

        // Verify secrets are there
        const get_result = run_command([
            'get', 'myapp:prod:SECRET_A',
        ], { vault_dir: bob_vault })
        expect(get_result.stdout.trim()).toBe('value_a')

        cleanup_vault(bob_vault)
    })
})

function create_bob_vault() {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'jseeqret-bob-vault-')
    )
    // Use run_command to init
    const parent = fs.mkdtempSync(
        path.join(os.tmpdir(), 'jseeqret-bob-parent-')
    )
    run_command([
        'init', parent,
        '--user', 'bob',
        '--email', 'bob@test.com',
    ], { env: { TESTING: 'TRUE' } })

    const vault_dir = path.join(parent, 'seeqret')
    return vault_dir
}
