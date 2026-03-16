import { describe, it, expect } from 'vitest'
import { User } from '../src/core/models/user.js'
import { generate_key_pair, encode_key } from '../src/core/crypto/nacl.js'

describe('User model', () => {
    it('stores username, email, pubkey', () => {
        const u = new User('alice', 'alice@test.com', 'base64pubkey')
        expect(u.username).toBe('alice')
        expect(u.email).toBe('alice@test.com')
        expect(u.pubkey).toBe('base64pubkey')
    })

    it('public_key decodes base64 pubkey to Uint8Array', () => {
        const kp = generate_key_pair()
        const encoded = encode_key(kp.publicKey)
        const u = new User('bob', 'bob@test.com', encoded)
        expect(u.public_key).toEqual(kp.publicKey)
        expect(u.public_key).toHaveLength(32)
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
