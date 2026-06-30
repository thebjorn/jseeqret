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
import { slack_config_set, SLACK_KEYS } from '../src/core/slack/config.js'
import {
    slack_attest_mfa,
    slack_session_status,
} from '../src/core/slack/session.js'

const now = Math.floor(Date.now() / 1000)

let tmp_dir
let storage

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-slkattest-'))
    generate_symmetric_key(tmp_dir)
    const kp = generate_and_save_key_pair(tmp_dir)
    await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', tmp_dir)

    // A session that is healthy except for the MFA attestation.
    await slack_config_set(storage, SLACK_KEYS.user_token, 'xoxp-fake')
    await slack_config_set(storage, SLACK_KEYS.channel_id, 'C1')
    await slack_config_set(storage, SLACK_KEYS.token_created_at, now)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('slack_attest_mfa (GUI attest control)', () => {
    it('status flags the MFA gap before attesting', async () => {
        const status = await slack_session_status(storage)
        expect(status.ready).toBe(false)
        expect(status.mfa_attested).toBe(false)
        expect(status.needs_mfa_attest).toBe(true)
        expect(status.problems.join(' ')).toMatch(/MFA not attested/)
    })

    it('recording the attestation clears the gap and readies the session', async () => {
        const stamped = await slack_attest_mfa(storage)
        expect(stamped).toBeTypeOf('number')

        const status = await slack_session_status(storage)
        expect(status.ready).toBe(true)
        expect(status.mfa_attested).toBe(true)
        expect(status.needs_mfa_attest).toBe(false)
        expect(status.problems).toEqual([])
    })

    it('flags a stale attestation for re-attestation (still mfa_attested)', async () => {
        await slack_config_set(
            storage, SLACK_KEYS.mfa_attested_at, now - 100 * 86400
        )
        const status = await slack_session_status(storage)
        expect(status.ready).toBe(false)
        expect(status.mfa_attested).toBe(true)
        expect(status.needs_mfa_attest).toBe(true)
    })
})
