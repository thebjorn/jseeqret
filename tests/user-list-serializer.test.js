import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { User } from '../src/core/models/user.js'
import { generate_symmetric_key } from '../src/core/crypto/utils.js'
import { encode_key, generate_key_pair } from '../src/core/crypto/nacl.js'
import { get_serializer } from '../src/core/serializers/base.js'
import { UserListSerializer } from '../src/core/serializers/user-list.js'

let tmp_dir
let tl_kp, user_kp
let tl, new_user
let teammates

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-ulist-'))
    generate_symmetric_key(tmp_dir)

    tl_kp = generate_key_pair()
    user_kp = generate_key_pair()

    tl = new User('lead@host', 'lead@test.com', encode_key(tl_kp.publicKey))
    new_user = new User('newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey))

    const a = generate_key_pair()
    const b = generate_key_pair()
    teammates = [
        new User('alice@host', 'alice@test.com', encode_key(a.publicKey)),
        new User('bob@host', 'bob@test.com', encode_key(b.publicKey)),
    ]
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('UserListSerializer', () => {
    it('is registered under the "user-list" tag', () => {
        expect(get_serializer('user-list')).toBe(UserListSerializer)
    })

    it('encrypts and round-trips a list of users', () => {
        const exporter = new UserListSerializer({
            sender: tl,
            receiver: new_user,
            sender_private_key: tl_kp.secretKey,
        })
        const json = exporter.dumps(teammates)
        const parsed = JSON.parse(json)

        expect(parsed.from).toBe('lead@host')
        expect(parsed.to).toBe('newbie@host')
        // The pubkeys must NOT be visible in the envelope.
        expect(json).not.toContain(teammates[0].pubkey)
        expect(parsed.signature).toHaveLength(5)

        const importer = new UserListSerializer({
            sender: tl,
            receiver: new_user,
            receiver_private_key: user_kp.secretKey,
        })
        const loaded = importer.load(json)

        expect(loaded).toHaveLength(2)
        expect(loaded.map(u => u.username).sort()).toEqual(['alice@host', 'bob@host'])
        expect(loaded[0]).toBeInstanceOf(User)
        expect(loaded[0].pubkey).toBe(teammates[0].pubkey)
        expect(loaded[0].email).toBe('alice@test.com')
    })

    it('cannot be decrypted by the wrong recipient (sender authenticity)', () => {
        const exporter = new UserListSerializer({
            sender: tl,
            receiver: new_user,
            sender_private_key: tl_kp.secretKey,
        })
        const json = exporter.dumps(teammates)

        const wrong_kp = generate_key_pair()
        const importer = new UserListSerializer({
            sender: tl,
            receiver: new_user,
            receiver_private_key: wrong_kp.secretKey,
        })
        expect(() => importer.load(json)).toThrow()
    })

    it('rejects a forged sender (Box authentication fails)', () => {
        const exporter = new UserListSerializer({
            sender: tl,
            receiver: new_user,
            sender_private_key: tl_kp.secretKey,
        })
        const json = exporter.dumps(teammates)

        // Receiver tries to decode claiming a different sender pubkey.
        const impostor = new User('evil', 'evil@x.com', encode_key(generate_key_pair().publicKey))
        const importer = new UserListSerializer({
            sender: impostor,
            receiver: new_user,
            receiver_private_key: user_kp.secretKey,
        })
        expect(() => importer.load(json)).toThrow()
    })
})
