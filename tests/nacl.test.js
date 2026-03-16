import { describe, it, expect } from 'vitest'
import {
    generate_key_pair,
    encode_key,
    decode_key,
    get_public_key,
    asymmetric_encrypt,
    asymmetric_decrypt,
    hash_message,
    fingerprint,
} from '../src/core/crypto/nacl.js'

describe('NaCl crypto', () => {
    describe('key generation', () => {
        it('generates a keypair with 32-byte keys', () => {
            const kp = generate_key_pair()
            expect(kp.publicKey).toHaveLength(32)
            expect(kp.secretKey).toHaveLength(32)
        })

        it('encode_key/decode_key round-trip', () => {
            const kp = generate_key_pair()
            const encoded = encode_key(kp.publicKey)
            expect(typeof encoded).toBe('string')
            const decoded = decode_key(encoded)
            expect(decoded).toEqual(kp.publicKey)
        })

        it('get_public_key derives correct public key from private', () => {
            const kp = generate_key_pair()
            const derived = get_public_key(kp.secretKey)
            expect(derived).toEqual(kp.publicKey)
        })
    })

    describe('asymmetric encrypt/decrypt', () => {
        it('round-trip between two keypairs', () => {
            const sender = generate_key_pair()
            const recipient = generate_key_pair()
            const plaintext = 'hello secure world'
            const encrypted = asymmetric_encrypt(plaintext, sender.secretKey, recipient.publicKey)
            const decrypted = asymmetric_decrypt(encrypted, recipient.secretKey, sender.publicKey)
            expect(decrypted).toBe(plaintext)
        })

        it('encrypted output is base64', () => {
            const sender = generate_key_pair()
            const recipient = generate_key_pair()
            const encrypted = asymmetric_encrypt('test', sender.secretKey, recipient.publicKey)
            expect(typeof encrypted).toBe('string')
            expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/)
        })

        it('fails with wrong recipient key', () => {
            const sender = generate_key_pair()
            const recipient = generate_key_pair()
            const wrong = generate_key_pair()
            const encrypted = asymmetric_encrypt('secret', sender.secretKey, recipient.publicKey)
            expect(() => {
                asymmetric_decrypt(encrypted, wrong.secretKey, sender.publicKey)
            }).toThrow('NaCl decryption failed')
        })

        it('handles unicode', () => {
            const sender = generate_key_pair()
            const recipient = generate_key_pair()
            const text = 'héllo 日本語 🔐'
            const encrypted = asymmetric_encrypt(text, sender.secretKey, recipient.publicKey)
            const decrypted = asymmetric_decrypt(encrypted, recipient.secretKey, sender.publicKey)
            expect(decrypted).toBe(text)
        })
    })

    describe('hashing', () => {
        it('hash_message returns 64-char hex string', () => {
            const hash = hash_message('hello')
            expect(hash).toHaveLength(64)
            expect(hash).toMatch(/^[0-9a-f]+$/)
        })

        it('hash_message is deterministic', () => {
            expect(hash_message('test')).toBe(hash_message('test'))
        })

        it('fingerprint returns last 5 chars of hash', () => {
            const hash = hash_message('hello')
            const fp = fingerprint('hello')
            expect(fp).toHaveLength(5)
            expect(fp).toBe(hash.slice(-5))
        })
    })
})
