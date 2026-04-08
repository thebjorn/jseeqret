import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { get_seeqret_dir, is_initialized, current_user } from '../src/core/vault.js'
import { registry_default } from '../src/core/vault-registry.js'

const has_registry_vault = !!registry_default()

let tmp_dir
let saved_jseeqret
let saved_seeqret

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-vault-'))
    saved_jseeqret = process.env.JSEEQRET
    saved_seeqret = process.env.SEEQRET
    delete process.env.JSEEQRET
    delete process.env.SEEQRET
})

afterEach(() => {
    if (saved_jseeqret !== undefined) process.env.JSEEQRET = saved_jseeqret
    else delete process.env.JSEEQRET
    if (saved_seeqret !== undefined) process.env.SEEQRET = saved_seeqret
    else delete process.env.SEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('get_seeqret_dir', () => {
    it('prefers JSEEQRET over SEEQRET', () => {
        process.env.JSEEQRET = '/path/jseeqret'
        process.env.SEEQRET = '/path/seeqret'
        expect(get_seeqret_dir()).toBe('/path/jseeqret')
    })

    it('falls back to SEEQRET if JSEEQRET not set', () => {
        process.env.SEEQRET = '/path/seeqret'
        expect(get_seeqret_dir()).toBe('/path/seeqret')
    })

    it.skipIf(has_registry_vault)('returns /srv/.seeqret on non-win32 when no env vars', () => {
        const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
        Object.defineProperty(process, 'platform', { value: 'linux' })
        try {
            expect(get_seeqret_dir()).toBe('/srv/.seeqret')
        } finally {
            Object.defineProperty(process, 'platform', origPlatform)
        }
    })

    it.skipIf(has_registry_vault)('throws on win32 when no env vars set', () => {
        if (process.platform === 'win32') {
            expect(() => get_seeqret_dir()).toThrow('environment variable is not set')
        }
    })
})

describe('is_initialized', () => {
    it.skipIf(has_registry_vault)('returns false when env var not set (win32)', () => {
        if (process.platform === 'win32') {
            expect(is_initialized()).toBe(false)
        }
    })

    it('returns false when dir does not exist', () => {
        process.env.JSEEQRET = path.join(tmp_dir, 'nonexistent')
        expect(is_initialized()).toBe(false)
    })

    it('returns false when dir exists but no db file', () => {
        process.env.JSEEQRET = tmp_dir
        expect(is_initialized()).toBe(false)
    })

    it('returns true when dir and db file exist', () => {
        process.env.JSEEQRET = tmp_dir
        fs.writeFileSync(path.join(tmp_dir, 'seeqrets.db'), '')
        expect(is_initialized()).toBe(true)
    })
})

describe('current_user', () => {
    it('returns a non-empty string', () => {
        const user = current_user()
        expect(typeof user).toBe('string')
        expect(user.length).toBeGreaterThan(0)
    })

    it('matches os.userInfo().username', () => {
        expect(current_user()).toBe(os.userInfo().username)
    })
})
