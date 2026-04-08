import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import {
    create_test_vault, cleanup_vault, run_command,
} from './cli-helpers.js'
import { registry_default } from '../src/core/vault-registry.js'

const has_registry_vault = !!registry_default()

const require = createRequire(import.meta.url)
const { version: pkg_version } = require('../package.json')

let tmp_dir

beforeEach(async () => {
    const vault = await create_test_vault()
    tmp_dir = vault.tmp_dir
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: info', () => {
    it('shows vault status when initialized', () => {
        const result = run_command([
            'info',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('initialized')
        expect(result.stdout).toContain('Commands:')
    })

    it.skipIf(has_registry_vault)('shows not initialized without vault', () => {
        const result = run_command([
            'info',
        ], { env: { JSEEQRET: '', SEEQRET: '' } })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('not initialized')
    })

    it('dumps JSON with --dump flag', () => {
        run_command([
            'add', 'key', 'A', 'val',
        ], { vault_dir: tmp_dir })

        const result = run_command([
            'info', '--dump',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        const info = JSON.parse(result.stdout)
        expect(info.initialized).toBe(true)
        expect(info.version).toBe(pkg_version)
        expect(info.owner).toBe('testuser')
        expect(info.secret_count).toBe(1)
        expect(info.user_count).toBe(1)
    })

    it.skipIf(has_registry_vault)('dumps JSON for uninitialized vault', () => {
        const result = run_command([
            'info', '--dump',
        ], { env: { JSEEQRET: '', SEEQRET: '' } })

        expect(result.exit_code).toBe(0)
        const info = JSON.parse(result.stdout)
        expect(info.initialized).toBe(false)
        expect(info.vault_dir).toBeNull()
    })
})

describe('CLI: upgrade', () => {
    it('reports database is up to date', () => {
        const result = run_command([
            'upgrade',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('up to date')
    })
})

describe('CLI: serializers', () => {
    it('lists available serializers', () => {
        const result = run_command([
            'serializers',
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(result.stdout).toContain('json-crypt')
        expect(result.stdout).toContain('backup')
        expect(result.stdout).toContain('command')
        expect(result.stdout).toContain('env')
    })
})
