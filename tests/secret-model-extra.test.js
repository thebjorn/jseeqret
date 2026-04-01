import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Secret } from '../src/core/models/secret.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key, generate_key_pair, decode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-secret-extra-'))
    generate_symmetric_key(tmp_dir)
    process.env.JSEEQRET = tmp_dir
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('Secret - encryption/decryption edge cases', () => {
    it('rejects empty string plaintext_value (treated as falsy)', () => {
        // Empty string is falsy in JS, so the constructor requires value or non-empty plaintext_value
        expect(() => new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: '', vault_dir: tmp_dir,
        })).toThrow('value or plaintext_value is required')
    })

    it('handles unicode values', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: '日本語テスト 🔑', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe('日本語テスト 🔑')
    })

    it('handles very long values', () => {
        const long_val = 'x'.repeat(10000)
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: long_val, vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe(long_val)
    })

    it('handles special characters', () => {
        const special = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~\n\t\r'
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: special, vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe(special)
    })

    it('handles numeric string values', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: '42', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe('42')
        expect(typeof s.get_value()).toBe('string')
    })

    it('handles numeric value with int type', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: '0', type: 'int', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe(0)
    })

    it('handles negative int values', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: '-42', type: 'int', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe(-42)
    })
})

describe('Secret - asymmetric encrypt/decrypt', () => {
    let sender_kp, receiver_kp

    beforeEach(() => {
        sender_kp = generate_key_pair()
        receiver_kp = generate_key_pair()
    })

    it('encrypt_value and decrypt_value round-trip', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'secret-data', vault_dir: tmp_dir,
        })
        const cipher = s.encrypt_value(sender_kp.secretKey, receiver_kp.publicKey)
        const plain = Secret.decrypt_value(cipher, sender_kp.publicKey, receiver_kp.secretKey)
        expect(plain).toBe('secret-data')
    })

    it('encrypt_to_dict contains all fields', () => {
        const s = new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'pw', type: 'str', vault_dir: tmp_dir,
        })
        const dict = s.encrypt_to_dict(sender_kp.secretKey, receiver_kp.publicKey)
        expect(dict.app).toBe('myapp')
        expect(dict.env).toBe('prod')
        expect(dict.key).toBe('DB_PASS')
        expect(dict.type).toBe('str')
        expect(dict.value).not.toBe('pw')
    })

    it('decrypt_value fails with wrong key', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'data', vault_dir: tmp_dir,
        })
        const cipher = s.encrypt_value(sender_kp.secretKey, receiver_kp.publicKey)
        const wrong_kp = generate_key_pair()
        expect(() => Secret.decrypt_value(cipher, sender_kp.publicKey, wrong_kp.secretKey)).toThrow()
    })
})

describe('Secret - toString', () => {
    it('includes all fields in string representation', () => {
        const s = new Secret({
            app: 'myapp', env: 'prod', key: 'KEY',
            plaintext_value: 'val', type: 'str', vault_dir: tmp_dir,
        })
        const str = s.toString()
        expect(str).toContain('myapp')
        expect(str).toContain('prod')
        expect(str).toContain('KEY')
        expect(str).toContain('val')
    })
})

describe('Secret - vault_dir resolution', () => {
    it('uses provided vault_dir', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'v', vault_dir: tmp_dir,
        })
        expect(s.vault_dir).toBe(tmp_dir)
    })

    it('falls back to JSEEQRET env var', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'v',
        })
        expect(s.vault_dir).toBe(tmp_dir)
    })
})

describe('Secret - construction from encrypted value', () => {
    it('can be constructed with pre-encrypted value', () => {
        const s1 = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'hello', vault_dir: tmp_dir,
        })
        const encrypted = s1.encrypted_value

        const s2 = new Secret({
            app: 'a', env: 'e', key: 'K',
            value: encrypted, vault_dir: tmp_dir,
        })
        expect(s2.get_value()).toBe('hello')
    })
})
