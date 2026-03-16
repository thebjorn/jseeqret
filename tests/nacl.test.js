import { describe, it, expect } from 'vitest'
import {
  generateKeyPair,
  encodeKey,
  decodeKey,
  getPublicKey,
  asymmetricEncrypt,
  asymmetricDecrypt,
  hashMessage,
  fingerprint,
} from '../src/core/crypto/nacl.js'

describe('NaCl crypto', () => {
  describe('key generation', () => {
    it('generates a keypair with 32-byte keys', () => {
      const kp = generateKeyPair()
      expect(kp.publicKey).toHaveLength(32)
      expect(kp.secretKey).toHaveLength(32)
    })

    it('encodeKey/decodeKey round-trip', () => {
      const kp = generateKeyPair()
      const encoded = encodeKey(kp.publicKey)
      expect(typeof encoded).toBe('string')
      const decoded = decodeKey(encoded)
      expect(decoded).toEqual(kp.publicKey)
    })

    it('getPublicKey derives correct public key from private', () => {
      const kp = generateKeyPair()
      const derived = getPublicKey(kp.secretKey)
      expect(derived).toEqual(kp.publicKey)
    })
  })

  describe('asymmetric encrypt/decrypt', () => {
    it('round-trip between two keypairs', () => {
      const sender = generateKeyPair()
      const recipient = generateKeyPair()
      const plaintext = 'hello secure world'
      const encrypted = asymmetricEncrypt(plaintext, sender.secretKey, recipient.publicKey)
      const decrypted = asymmetricDecrypt(encrypted, recipient.secretKey, sender.publicKey)
      expect(decrypted).toBe(plaintext)
    })

    it('encrypted output is base64', () => {
      const sender = generateKeyPair()
      const recipient = generateKeyPair()
      const encrypted = asymmetricEncrypt('test', sender.secretKey, recipient.publicKey)
      expect(typeof encrypted).toBe('string')
      // Standard base64
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('fails with wrong recipient key', () => {
      const sender = generateKeyPair()
      const recipient = generateKeyPair()
      const wrong = generateKeyPair()
      const encrypted = asymmetricEncrypt('secret', sender.secretKey, recipient.publicKey)
      expect(() => {
        asymmetricDecrypt(encrypted, wrong.secretKey, sender.publicKey)
      }).toThrow('NaCl decryption failed')
    })

    it('handles unicode', () => {
      const sender = generateKeyPair()
      const recipient = generateKeyPair()
      const text = 'héllo 日本語 🔐'
      const encrypted = asymmetricEncrypt(text, sender.secretKey, recipient.publicKey)
      const decrypted = asymmetricDecrypt(encrypted, recipient.secretKey, sender.publicKey)
      expect(decrypted).toBe(text)
    })
  })

  describe('hashing', () => {
    it('hashMessage returns 64-char hex string', () => {
      const hash = hashMessage('hello')
      expect(hash).toHaveLength(64)
      expect(hash).toMatch(/^[0-9a-f]+$/)
    })

    it('hashMessage is deterministic', () => {
      expect(hashMessage('test')).toBe(hashMessage('test'))
    })

    it('fingerprint returns last 5 chars of hash', () => {
      const hash = hashMessage('hello')
      const fp = fingerprint('hello')
      expect(fp).toHaveLength(5)
      expect(fp).toBe(hash.slice(-5))
    })
  })
})
