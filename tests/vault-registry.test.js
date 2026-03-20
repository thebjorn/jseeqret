import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    read_registry, write_registry,
    registry_add, registry_remove, registry_use,
    registry_list, registry_resolve, registry_default,
    get_registry_dir, get_registry_file,
} from '../src/core/vault-registry.js'

let original_homedir
let tmp_home

beforeEach(() => {
    tmp_home = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-reg-test-'))
    original_homedir = os.homedir
    os.homedir = () => tmp_home
})

afterEach(() => {
    os.homedir = original_homedir
    delete process.env.JSEEQRET
    delete process.env.SEEQRET
    fs.rmSync(tmp_home, { recursive: true, force: true })
})

// Helper: create a temp vault path that works on any OS
function make_vault_path(name) {
    return path.join(tmp_home, name)
}

describe('vault-registry', () => {
    describe('read_registry', () => {
        it('returns empty object when no registry file exists', () => {
            expect(read_registry()).toEqual({})
        })

        it('reads existing registry', () => {
            const reg_dir = path.join(tmp_home, '.seeqret')
            fs.mkdirSync(reg_dir, { recursive: true })
            const vault_path = make_vault_path('work-vault')
            fs.writeFileSync(
                path.join(reg_dir, 'vaults.json'),
                JSON.stringify({ work: vault_path }),
            )
            const reg = read_registry()
            expect(reg).toEqual({ work: vault_path })
        })
    })

    describe('write_registry', () => {
        it('creates ~/.seeqret directory if missing', () => {
            write_registry({ test: make_vault_path('vault') })
            const reg_dir = path.join(tmp_home, '.seeqret')
            expect(fs.existsSync(reg_dir)).toBe(true)
            expect(fs.existsSync(path.join(reg_dir, 'vaults.json'))).toBe(true)
        })
    })

    describe('registry_add', () => {
        it('adds a vault to the registry', () => {
            const vault_path = make_vault_path('work-vault')
            registry_add('work', vault_path)
            const reg = read_registry()
            expect(reg.work).toBe(vault_path)
        })

        it('rejects _default as a vault name', () => {
            expect(() => registry_add('_default', '/tmp')).toThrow(
                'Cannot use "_default" as a vault name',
            )
        })

        it('overwrites existing vault with same name', () => {
            const old_path = make_vault_path('old')
            const new_path = make_vault_path('new')
            registry_add('work', old_path)
            registry_add('work', new_path)
            expect(registry_resolve('work')).toBe(new_path)
        })
    })

    describe('registry_remove', () => {
        it('removes a registered vault', () => {
            const vault_path = make_vault_path('work-vault')
            registry_add('work', vault_path)
            const removed = registry_remove('work')
            expect(removed).toBe(true)
            expect(registry_resolve('work')).toBeNull()
        })

        it('returns false for non-existent vault', () => {
            expect(registry_remove('nope')).toBe(false)
        })

        it('clears _default when removing the default vault', () => {
            const vault_path = make_vault_path('work-vault')
            registry_add('work', vault_path)
            registry_use('work')
            registry_remove('work')
            expect(registry_default()).toBeNull()
        })

        it('rejects removing _default directly', () => {
            expect(() => registry_remove('_default')).toThrow(
                'Cannot remove "_default" directly',
            )
        })
    })

    describe('registry_use', () => {
        it('sets the default vault', () => {
            registry_add('work', make_vault_path('work-vault'))
            registry_use('work')
            expect(registry_default()).toBe('work')
        })

        it('throws for unregistered vault name', () => {
            expect(() => registry_use('nope')).toThrow(
                'Vault "nope" is not registered',
            )
        })
    })

    describe('registry_list', () => {
        it('returns empty array when no vaults registered', () => {
            expect(registry_list()).toEqual([])
        })

        it('lists vaults with default flag', () => {
            const work_path = make_vault_path('work-vault')
            const personal_path = make_vault_path('personal-vault')
            registry_add('work', work_path)
            registry_add('personal', personal_path)
            registry_use('work')
            const vaults = registry_list()
            expect(vaults).toHaveLength(2)

            const work = vaults.find(v => v.name === 'work')
            expect(work.is_default).toBe(true)
            expect(work.path).toBe(work_path)

            const personal = vaults.find(v => v.name === 'personal')
            expect(personal.is_default).toBe(false)
        })
    })

    describe('registry_resolve', () => {
        it('resolves a vault name to its path', () => {
            const vault_path = make_vault_path('work-vault')
            registry_add('work', vault_path)
            expect(registry_resolve('work')).toBe(vault_path)
        })

        it('returns null for unknown vault', () => {
            expect(registry_resolve('nope')).toBeNull()
        })
    })
})

describe('vault.js name resolution', () => {
    let get_seeqret_dir

    beforeEach(async () => {
        const mod = await import('../src/core/vault.js')
        get_seeqret_dir = mod.get_seeqret_dir
    })

    it('resolves absolute path from JSEEQRET as-is', () => {
        const vault_path = make_vault_path('my-vault')
        process.env.JSEEQRET = vault_path
        expect(get_seeqret_dir()).toBe(vault_path)
    })

    it('resolves vault name from JSEEQRET via registry', () => {
        const vault_path = make_vault_path('work-vault')
        registry_add('work', vault_path)
        process.env.JSEEQRET = 'work'
        expect(get_seeqret_dir()).toBe(vault_path)
    })

    it('throws for unknown vault name in JSEEQRET', () => {
        process.env.JSEEQRET = 'nonexistent'
        expect(() => get_seeqret_dir()).toThrow(
            'Vault name "nonexistent" (from JSEEQRET) not found in registry',
        )
    })

    it('uses registry default when no env var set', () => {
        const vault_path = make_vault_path('personal-vault')
        registry_add('personal', vault_path)
        registry_use('personal')
        expect(get_seeqret_dir()).toBe(vault_path)
    })
})
