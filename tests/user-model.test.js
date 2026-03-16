import { describe, it, expect } from 'vitest'
import { User } from '../src/core/models/user.js'
import { generateKeyPair, encodeKey } from '../src/core/crypto/nacl.js'

describe('User model', () => {
  it('stores username, email, pubkey', () => {
    const u = new User('alice', 'alice@test.com', 'base64pubkey')
    expect(u.username).toBe('alice')
    expect(u.email).toBe('alice@test.com')
    expect(u.pubkey).toBe('base64pubkey')
  })

  it('publicKey decodes base64 pubkey to Uint8Array', () => {
    const kp = generateKeyPair()
    const encoded = encodeKey(kp.publicKey)
    const u = new User('bob', 'bob@test.com', encoded)
    expect(u.publicKey).toEqual(kp.publicKey)
    expect(u.publicKey).toHaveLength(32)
  })

  it('row returns [username, email, pubkey]', () => {
    const u = new User('alice', 'a@b.com', 'pk')
    expect(u.row).toEqual(['alice', 'a@b.com', 'pk'])
  })

  it('toJSON returns plain object', () => {
    const u = new User('alice', 'a@b.com', 'pk')
    expect(u.toJSON()).toEqual({
      username: 'alice', email: 'a@b.com', pubkey: 'pk',
    })
  })

  it('toString includes username', () => {
    const u = new User('alice', 'a@b.com', 'pk')
    expect(u.toString()).toContain('alice')
  })
})
