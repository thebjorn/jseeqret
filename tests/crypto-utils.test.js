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
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-crypto-utils-'))
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('generate_symmetric_key', () => {
    it('creates a key file and returns the key', () => {
        const key = generate_symmetric_key(tmp_dir)
        expect(typeof key).toBe('string')
        expect(key.length).toBeGreaterThan(0)
        expect(fs.existsSync(path.join(tmp_dir, 'seeqret.key'))).toBe(true)
    })

    it('uses custom filename', () => {
        const key = generate_symmetric_key(tmp_dir, 'custom.key')
        expect(fs.existsSync(path.join(tmp_dir, 'custom.key'))).toBe(true)
        expect(key.length).toBeGreaterThan(0)
    })

    it('generates unique keys each time', () => {
        const key1 = generate_symmetric_key(tmp_dir, 'k1.key')
        const key2 = generate_symmetric_key(tmp_dir, 'k2.key')
        expect(key1).not.toBe(key2)
    })
})

describe('load_symmetric_key', () => {
    it('loads an existing key file', () => {
        const original = generate_symmetric_key(tmp_dir)
        const loaded = load_symmetric_key(tmp_dir)
        expect(loaded).toBe(original)
    })

    it('trims whitespace from key', () => {
        fs.writeFileSync(path.join(tmp_dir, 'seeqret.key'), '  mykey  \n')
        expect(load_symmetric_key(tmp_dir)).toBe('mykey')
    })

    it('throws for missing file', () => {
        expect(() => load_symmetric_key(tmp_dir)).toThrow()
    })
})

describe('get_or_create_symmetric_key', () => {
    it('creates key if not present', () => {
        const key = get_or_create_symmetric_key(tmp_dir)
        expect(typeof key).toBe('string')
        expect(fs.existsSync(path.join(tmp_dir, 'seeqret.key'))).toBe(true)
    })

    it('loads existing key without overwriting', () => {
        const created = get_or_create_symmetric_key(tmp_dir)
        const loaded = get_or_create_symmetric_key(tmp_dir)
        expect(loaded).toBe(created)
    })

    it('uses custom filename', () => {
        const key = get_or_create_symmetric_key(tmp_dir, 'alt.key')
        expect(fs.existsSync(path.join(tmp_dir, 'alt.key'))).toBe(true)
        const again = get_or_create_symmetric_key(tmp_dir, 'alt.key')
        expect(again).toBe(key)
    })
})

describe('generate_and_save_key_pair', () => {
    it('creates private.key and public.key files', () => {
        generate_and_save_key_pair(tmp_dir)
        expect(fs.existsSync(path.join(tmp_dir, 'private.key'))).toBe(true)
        expect(fs.existsSync(path.join(tmp_dir, 'public.key'))).toBe(true)
    })

    it('returns keypair with publicKey and secretKey', () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        expect(kp.publicKey).toBeInstanceOf(Uint8Array)
        expect(kp.secretKey).toBeInstanceOf(Uint8Array)
        expect(kp.publicKey.length).toBe(32)
        expect(kp.secretKey.length).toBe(32)
    })

    it('saved keys can be loaded back', () => {
        generate_and_save_key_pair(tmp_dir)
        const priv = load_private_key_str(tmp_dir)
        const pub = load_public_key_str(tmp_dir)
        expect(typeof priv).toBe('string')
        expect(typeof pub).toBe('string')
        // Should be valid base64
        expect(decode_key(priv).length).toBe(32)
        expect(decode_key(pub).length).toBe(32)
    })
})

describe('load_private_key_str / load_public_key_str', () => {
    it('throws for missing files', () => {
        expect(() => load_private_key_str(tmp_dir)).toThrow()
        expect(() => load_public_key_str(tmp_dir)).toThrow()
    })

    it('trims whitespace', () => {
        fs.writeFileSync(path.join(tmp_dir, 'private.key'), '  privkey  \n')
        fs.writeFileSync(path.join(tmp_dir, 'public.key'), '  pubkey  \n')
        expect(load_private_key_str(tmp_dir)).toBe('privkey')
        expect(load_public_key_str(tmp_dir)).toBe('pubkey')
    })
})
