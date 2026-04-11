import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import {
    slack_config_get,
    slack_config_set,
    slack_config_delete,
    slack_config_clear_all,
    slack_config_snapshot,
    SLACK_KEYS,
} from '../src/core/slack/config.js'

let tmp_dir
let storage

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-slkcfg-'))
    generate_symmetric_key(tmp_dir)
    const kp = generate_and_save_key_pair(tmp_dir)
    await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('slack config (fernet-wrapped kv)', () => {
    it('round-trips a string value', async () => {
        await slack_config_set(storage, SLACK_KEYS.user_token, 'xoxp-fake')
        const got = await slack_config_get(storage, SLACK_KEYS.user_token)
        expect(got).toBe('xoxp-fake')
    })

    it('round-trips an object value', async () => {
        const val = { a: 1, b: [2, 3], c: 'x' }
        await slack_config_set(storage, 'slack.custom', val)
        const got = await slack_config_get(storage, 'slack.custom')
        expect(got).toEqual(val)
    })

    it('returns null for missing keys', async () => {
        const got = await slack_config_get(storage, 'slack.never_set')
        expect(got).toBeNull()
    })

    it('overwrites existing values on set', async () => {
        await slack_config_set(storage, SLACK_KEYS.team_name, 'v1')
        await slack_config_set(storage, SLACK_KEYS.team_name, 'v2')
        expect(await slack_config_get(storage, SLACK_KEYS.team_name)).toBe('v2')
    })

    it('delete removes a value', async () => {
        await slack_config_set(storage, SLACK_KEYS.user_token, 'xoxp-x')
        await slack_config_delete(storage, SLACK_KEYS.user_token)
        expect(await slack_config_get(storage, SLACK_KEYS.user_token)).toBeNull()
    })

    it('clear_all wipes every slack.* entry but leaves unrelated rows', async () => {
        await slack_config_set(storage, SLACK_KEYS.user_token, 'tok')
        await slack_config_set(storage, SLACK_KEYS.team_id, 'T1')
        await storage.kv_set('other.key', Buffer.from('unrelated'))

        await slack_config_clear_all(storage)

        expect(await slack_config_get(storage, SLACK_KEYS.user_token)).toBeNull()
        expect(await slack_config_get(storage, SLACK_KEYS.team_id)).toBeNull()
        const other = await storage.kv_get('other.key')
        expect(other).not.toBeNull()
    })

    it('snapshot returns every known key, nulling missing ones', async () => {
        await slack_config_set(storage, SLACK_KEYS.team_name, 'ntseeqrets')
        const snap = await slack_config_snapshot(storage)
        expect(snap.team_name).toBe('ntseeqrets')
        expect(snap.user_token).toBeNull()
        expect(snap.channel_id).toBeNull()
    })

    it('stored blob is actually fernet-encrypted (not plaintext)', async () => {
        await slack_config_set(storage, SLACK_KEYS.user_token, 'xoxp-SECRET')
        const blob = await storage.kv_get(SLACK_KEYS.user_token)
        expect(blob).not.toBeNull()
        // The raw bytes must not contain the plaintext.
        expect(blob.toString('utf-8')).not.toContain('xoxp-SECRET')
    })
})
