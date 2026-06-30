import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    slack_config_set,
    slack_config_snapshot,
    SLACK_KEYS,
} from '../src/core/slack/config.js'

// Stub the OAuth flow and the SlackClient so slack_oauth_login is exercised
// without dialing Slack.
const run_oauth_flow = vi.fn()
vi.mock('../src/core/slack/oauth.js', () => ({ run_oauth_flow }))

const list_private_channels = vi.fn()
vi.mock('../src/core/slack/client.js', () => ({
    SlackClient: class {
        constructor(token) { this.token = token }
        list_private_channels() { return list_private_channels() }
    },
}))

const {
    slack_oauth_login,
    slack_set_channel,
    slack_session_status,
} = await import('../src/core/slack/session.js')

let tmp_dir
let storage

beforeEach(async () => {
    run_oauth_flow.mockReset()
    list_private_channels.mockReset()
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-slksess-'))
    generate_symmetric_key(tmp_dir)
    const kp = generate_and_save_key_pair(tmp_dir)
    await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('slack_oauth_login', () => {
    it('persists token + identity and returns the channel list', async () => {
        run_oauth_flow.mockResolvedValue({
            access_token: 'xoxp-new',
            team_id: 'T1',
            team_name: 'acme',
            user_id: 'U1',
        })
        list_private_channels.mockResolvedValue([
            { id: 'C1', name: 'seeqrets' },
        ])

        const opener = () => {}
        const out = await slack_oauth_login(storage, { open_browser: opener })

        expect(out).toEqual({
            user_id: 'U1',
            team_name: 'acme',
            team_id: 'T1',
            channels: [{ id: 'C1', name: 'seeqrets' }],
        })
        // The opener is threaded through to the OAuth flow.
        expect(run_oauth_flow).toHaveBeenCalledWith({ open_browser: opener })

        // The fernet-wrapped config now holds the token + identity + ts.
        const snap = await slack_config_snapshot(storage)
        expect(snap.user_token).toBe('xoxp-new')
        expect(snap.team_id).toBe('T1')
        expect(snap.team_name).toBe('acme')
        expect(snap.user_id).toBe('U1')
        expect(typeof snap.token_created_at).toBe('number')
    })
})

describe('slack_session_status', () => {
    it('reports a logged-out session as not ready', async () => {
        const status = await slack_session_status(storage)
        expect(status.logged_in).toBe(false)
        expect(status.ready).toBe(false)
        expect(status.token_age_days).toBeNull()
        expect(status.problems.length).toBeGreaterThan(0)
    })

    it('reports a fully configured session as ready', async () => {
        const now = Math.floor(Date.now() / 1000)
        await slack_config_set(storage, SLACK_KEYS.user_token, 'xoxp-x')
        await slack_config_set(storage, SLACK_KEYS.user_id, 'U1')
        await slack_config_set(storage, SLACK_KEYS.team_name, 'acme')
        await slack_config_set(storage, SLACK_KEYS.team_id, 'T1')
        await slack_config_set(storage, SLACK_KEYS.token_created_at, now)
        await slack_config_set(storage, SLACK_KEYS.mfa_attested_at, now)
        await slack_set_channel(storage, 'C1', 'seeqrets')

        const status = await slack_session_status(storage)
        expect(status.logged_in).toBe(true)
        expect(status.ready).toBe(true)
        expect(status.problems).toEqual([])
        expect(status.channel_id).toBe('C1')
        expect(status.channel_name).toBe('seeqrets')
        expect(status.token_age_days).toBe(0)
        expect(status.mfa_attested).toBe(true)
    })
})
