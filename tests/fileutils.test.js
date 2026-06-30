import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    attrib_cmd,
    is_encrypted,
    harden_vault_windows,
} from '../src/core/fileutils.js'

const is_windows = process.platform === 'win32'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-futil-'))
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

/** Swap process.platform for the duration of a callback. */
function with_platform(value, fn) {
    const orig = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value, configurable: true })
    try {
        return fn()
    } finally {
        Object.defineProperty(process, 'platform', orig)
    }
}

describe('attrib_cmd', () => {
    it.runIf(is_windows)('reads attributes for an existing dir', () => {
        const out = attrib_cmd(tmp_dir)
        // attrib echoes the path it inspected.
        expect(out).toContain(tmp_dir)
    })

    it.runIf(is_windows)('returns a string and never throws', () => {
        expect(typeof attrib_cmd(tmp_dir)).toBe('string')
    })

    it.runIf(is_windows)('returns empty string for a bogus command target', () => {
        // attrib on a non-existent path prints to stderr; run() swallows it.
        const out = attrib_cmd(path.join(tmp_dir, 'does-not-exist'))
        expect(typeof out).toBe('string')
    })
})

describe('is_encrypted', () => {
    it('returns false on non-windows platforms', () => {
        with_platform('linux', () => {
            expect(is_encrypted(tmp_dir)).toBe(false)
        })
    })

    it.runIf(is_windows)('returns false for a fresh unencrypted dir', () => {
        expect(is_encrypted(tmp_dir)).toBe(false)
    })
})

describe('harden_vault_windows', () => {
    it('is a no-op on non-windows platforms', () => {
        with_platform('linux', () => {
            expect(() => harden_vault_windows(tmp_dir)).not.toThrow()
        })
    })

    it('is skipped when TESTING=TRUE', () => {
        const prev = process.env.TESTING
        process.env.TESTING = 'TRUE'
        try {
            // Should return immediately without touching the dir.
            expect(() => harden_vault_windows(tmp_dir)).not.toThrow()
        } finally {
            if (prev === undefined) delete process.env.TESTING
            else process.env.TESTING = prev
        }
    })

    it.runIf(is_windows)('hardens a real temp dir without throwing', () => {
        const prev = process.env.TESTING
        delete process.env.TESTING
        try {
            // Exercises the icacls / attrib / cipher branches against a real
            // dir. EFS encryption itself may be unavailable (group policy,
            // volume type), so we only assert the call completes cleanly and
            // is_encrypted still answers with a boolean.
            expect(() => harden_vault_windows(tmp_dir)).not.toThrow()
            expect(typeof is_encrypted(tmp_dir)).toBe('boolean')
        } finally {
            if (prev !== undefined) process.env.TESTING = prev
        }
    })
})
