import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    load_symmetric_key,
    generate_symmetric_key,
    get_or_create_symmetric_key,
    generate_and_save_key_pair,
    load_private_key_str,
    load_public_key_str,
} from '../src/core/crypto/utils.js'
import { decode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('generate_symmetric_key', () => {
    it('creates a key file and returns the key', () => {
        const key = generate_symmetric_key(tmp_dir)
        expect(key).toHaveLength(44)
        expect(fs.existsSync(path.join(tmp_dir, 'seeqret.key'))).toBe(true)
    })

    it('uses custom filename', () => {
        generate_symmetric_key(tmp_dir, 'custom.key')
        expect(fs.existsSync(path.join(tmp_dir, 'custom.key'))).toBe(true)
    })

    it('file content matches returned key', () => {
        const key = generate_symmetric_key(tmp_dir)
        const file_content = fs.readFileSync(path.join(tmp_dir, 'seeqret.key'), 'utf-8')
        expect(file_content).toBe(key)
    })
})

describe('load_symmetric_key', () => {
    it('reads the key from file', () => {
        const original = generate_symmetric_key(tmp_dir)
        const loaded = load_symmetric_key(tmp_dir)
        expect(loaded).toBe(original)
    })

    it('trims whitespace', () => {
        fs.writeFileSync(path.join(tmp_dir, 'seeqret.key'), '  somekey  \n', 'utf-8')
        const loaded = load_symmetric_key(tmp_dir)
        expect(loaded).toBe('somekey')
    })

    it('throws on missing file', () => {
        expect(() => load_symmetric_key(tmp_dir)).toThrow()
    })

    it('uses custom filename', () => {
        fs.writeFileSync(path.join(tmp_dir, 'other.key'), 'testkey', 'utf-8')
        const loaded = load_symmetric_key(tmp_dir, 'other.key')
        expect(loaded).toBe('testkey')
    })
})

describe('get_or_create_symmetric_key', () => {
    it('loads existing key', () => {
        const original = generate_symmetric_key(tmp_dir)
        const loaded = get_or_create_symmetric_key(tmp_dir)
        expect(loaded).toBe(original)
    })

    it('generates key when file missing', () => {
        const key = get_or_create_symmetric_key(tmp_dir)
        expect(key).toHaveLength(44)
        expect(fs.existsSync(path.join(tmp_dir, 'seeqret.key'))).toBe(true)
    })

    it('second call returns same key', () => {
        const first = get_or_create_symmetric_key(tmp_dir)
        const second = get_or_create_symmetric_key(tmp_dir)
        expect(second).toBe(first)
    })
})

describe('generate_and_save_key_pair', () => {
    it('creates private.key and public.key files', () => {
        generate_and_save_key_pair(tmp_dir)
        expect(fs.existsSync(path.join(tmp_dir, 'private.key'))).toBe(true)
        expect(fs.existsSync(path.join(tmp_dir, 'public.key'))).toBe(true)
    })

    it('returns keypair with 32-byte keys', () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        expect(kp.publicKey).toHaveLength(32)
        expect(kp.secretKey).toHaveLength(32)
    })

    it('saved keys can be loaded back', () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        const priv_str = load_private_key_str(tmp_dir)
        const pub_str = load_public_key_str(tmp_dir)
        expect(decode_key(priv_str)).toEqual(kp.secretKey)
        expect(decode_key(pub_str)).toEqual(kp.publicKey)
    })
})

describe('load_private_key_str / load_public_key_str', () => {
    it('returns base64-encoded strings', () => {
        generate_and_save_key_pair(tmp_dir)
        const priv = load_private_key_str(tmp_dir)
        const pub = load_public_key_str(tmp_dir)
        expect(typeof priv).toBe('string')
        expect(typeof pub).toBe('string')
        // Base64 of 32 bytes = 44 chars
        expect(priv).toHaveLength(44)
        expect(pub).toHaveLength(44)
    })

    it('throws when files are missing', () => {
        expect(() => load_private_key_str(tmp_dir)).toThrow()
        expect(() => load_public_key_str(tmp_dir)).toThrow()
    })
})
