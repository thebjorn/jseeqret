import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { get_seeqret_dir, is_initialized, current_user } from '../src/core/vault.js'

let saved_jseeqret
let saved_seeqret
let tmp_dir

beforeEach(() => {
    saved_jseeqret = process.env.JSEEQRET
    saved_seeqret = process.env.SEEQRET
    delete process.env.JSEEQRET
    delete process.env.SEEQRET
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
})

afterEach(() => {
    if (saved_jseeqret !== undefined) {
        process.env.JSEEQRET = saved_jseeqret
    } else {
        delete process.env.JSEEQRET
    }
    if (saved_seeqret !== undefined) {
        process.env.SEEQRET = saved_seeqret
    } else {
        delete process.env.SEEQRET
    }
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('get_seeqret_dir', () => {
    it('prefers JSEEQRET env var', () => {
        process.env.JSEEQRET = '/some/path'
        process.env.SEEQRET = '/other/path'
        expect(get_seeqret_dir()).toBe('/some/path')
    })

    it('falls back to SEEQRET env var', () => {
        process.env.SEEQRET = '/fallback/path'
        expect(get_seeqret_dir()).toBe('/fallback/path')
    })

    it('returns default on non-Windows when no env vars', () => {
        if (process.platform === 'win32') {
            expect(() => get_seeqret_dir()).toThrow('JSEEQRET')
        } else {
            expect(get_seeqret_dir()).toBe('/srv/.seeqret')
        }
    })
})

describe('is_initialized', () => {
    it('returns false when env var not set (Windows)', () => {
        if (process.platform === 'win32') {
            expect(is_initialized()).toBe(false)
        }
    })

    it('returns false when directory does not exist', () => {
        process.env.JSEEQRET = path.join(tmp_dir, 'nonexistent')
        expect(is_initialized()).toBe(false)
    })

    it('returns false when db file is missing', () => {
        process.env.JSEEQRET = tmp_dir
        expect(is_initialized()).toBe(false)
    })

    it('returns true when vault dir and db exist', () => {
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
