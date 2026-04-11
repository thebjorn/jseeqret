import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { User } from '../src/core/models/user.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key, generate_key_pair } from '../src/core/crypto/nacl.js'
import {
    compute_fingerprint,
    bind_slack_handle,
    require_verified_binding,
    find_user_by_slack_handle,
} from '../src/core/slack/identity.js'

let tmp_dir
let storage

async function _make_vault() {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-slkid-'))
    generate_symmetric_key(tmp_dir)
    const kp = generate_and_save_key_pair(tmp_dir)
    await run_migrations(tmp_dir, 'admin', 'admin@test.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
}

beforeEach(async () => {
    await _make_vault()
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('slack identity binding', () => {
    it('compute_fingerprint is stable and 5 hex chars', async () => {
        const kp = generate_key_pair()
        const u = new User('bob', 'b@b.com', encode_key(kp.publicKey))
        const fp = compute_fingerprint(u)
        expect(fp).toHaveLength(5)
        expect(fp).toMatch(/^[0-9a-f]{5}$/)
        expect(compute_fingerprint(u)).toBe(fp)
    })

    it('bind_slack_handle persists handle, fingerprint, timestamp', async () => {
        const kp = generate_key_pair()
        const pk = encode_key(kp.publicKey)
        await storage.add_user(new User('bob', 'bob@test.com', pk))

        const { fingerprint: fp } = await bind_slack_handle(storage, 'bob', 'bob_slk')

        const refetched = await storage.fetch_user('bob')
        expect(refetched.slack_handle).toBe('bob_slk')
        expect(refetched.slack_key_fingerprint).toBe(fp)
        expect(refetched.slack_verified_at).toBeGreaterThan(0)
    })

    it('require_verified_binding passes for a fresh binding', async () => {
        const kp = generate_key_pair()
        await storage.add_user(new User('bob', 'bob@test.com', encode_key(kp.publicKey)))
        await bind_slack_handle(storage, 'bob', 'bob_slk')

        const r = await require_verified_binding(storage, 'bob')
        expect(r.slack_handle).toBe('bob_slk')
    })

    it('require_verified_binding refuses an unlinked user', async () => {
        const kp = generate_key_pair()
        await storage.add_user(new User('bob', 'bob@test.com', encode_key(kp.publicKey)))

        await expect(require_verified_binding(storage, 'bob'))
            .rejects.toThrow(/not linked/)
    })

    it('require_verified_binding refuses if fingerprint drifted', async () => {
        const kp1 = generate_key_pair()
        await storage.add_user(new User('bob', 'bob@test.com', encode_key(kp1.publicKey)))
        await bind_slack_handle(storage, 'bob', 'bob_slk')

        // Rotate bob's key behind our back.
        const kp2 = generate_key_pair()
        await storage._with_db((db) => {
            db.run('UPDATE users SET pubkey = ? WHERE username = ?', [
                encode_key(kp2.publicKey), 'bob',
            ])
        }, true)

        await expect(require_verified_binding(storage, 'bob'))
            .rejects.toThrow(/no longer matches/)
    })

    it('find_user_by_slack_handle returns the matching user', async () => {
        const kp = generate_key_pair()
        await storage.add_user(new User('carol', 'c@t.com', encode_key(kp.publicKey)))
        await bind_slack_handle(storage, 'carol', 'carol_slk')

        const u = await find_user_by_slack_handle(storage, 'carol_slk')
        expect(u).not.toBeNull()
        expect(u.username).toBe('carol')
    })

    it('find_user_by_slack_handle returns null for unknown handle', async () => {
        const u = await find_user_by_slack_handle(storage, 'nobody')
        expect(u).toBeNull()
    })
})
