import { describe, it, expect } from 'vitest'
import { generateKey, encrypt, decrypt } from '../src/core/crypto/fernet.js'

describe('Fernet', () => {
  it('generateKey returns a 44-char base64url string', () => {
    const key = generateKey()
    expect(key).toHaveLength(44)
    // base64url characters only
    expect(key).toMatch(/^[A-Za-z0-9_-]+=*$/)
  })

  it('encrypt/decrypt round-trip', () => {
    const key = generateKey()
    const plaintext = Buffer.from('hello world', 'utf-8')
    const token = encrypt(key, plaintext)
    const decrypted = decrypt(key, token)
    expect(decrypted.toString('utf-8')).toBe('hello world')
  })

  it('encrypt returns a string (base64url token)', () => {
    const key = generateKey()
    const token = encrypt(key, Buffer.from('test', 'utf-8'))
    expect(typeof token).toBe('string')
    expect(token).toMatch(/^[A-Za-z0-9_-]+=*$/)
  })

  it('decrypt rejects tampered token', () => {
    const key = generateKey()
    const token = encrypt(key, Buffer.from('data', 'utf-8'))
    // Flip a character in the middle of the token
    const tampered = token.slice(0, 20) + 'X' + token.slice(21)
    expect(() => decrypt(key, tampered)).toThrow()
  })

  it('decrypt rejects wrong key', () => {
    const key1 = generateKey()
    const key2 = generateKey()
    const token = encrypt(key1, Buffer.from('secret', 'utf-8'))
    expect(() => decrypt(key2, token)).toThrow()
  })

  it('handles empty plaintext', () => {
    const key = generateKey()
    const token = encrypt(key, Buffer.from('', 'utf-8'))
    const decrypted = decrypt(key, token)
    expect(decrypted.toString('utf-8')).toBe('')
  })

  it('handles unicode plaintext', () => {
    const key = generateKey()
    const text = 'héllo wörld 日本語'
    const token = encrypt(key, Buffer.from(text, 'utf-8'))
    const decrypted = decrypt(key, token)
    expect(decrypted.toString('utf-8')).toBe(text)
  })

  it('produces different tokens for same plaintext (random IV)', () => {
    const key = generateKey()
    const plaintext = Buffer.from('same', 'utf-8')
    const token1 = encrypt(key, plaintext)
    const token2 = encrypt(key, plaintext)
    expect(token1).not.toBe(token2)
  })

  it('decrypt accepts Buffer token', () => {
    const key = generateKey()
    const token = encrypt(key, Buffer.from('test', 'utf-8'))
    const tokenBuf = Buffer.from(token, 'utf-8')
    const decrypted = decrypt(key, tokenBuf)
    expect(decrypted.toString('utf-8')).toBe('test')
  })

  it('decrypt accepts Uint8Array token', () => {
    const key = generateKey()
    const token = encrypt(key, Buffer.from('test', 'utf-8'))
    const tokenArr = new Uint8Array(Buffer.from(token, 'utf-8'))
    const decrypted = decrypt(key, tokenArr)
    expect(decrypted.toString('utf-8')).toBe('test')
  })
})
