import { describe, it, expect } from 'vitest'
import { MockSlackWorkspace } from './slack-mock.js'
import { MESSAGE_KINDS } from '../src/core/serializers/envelope.js'
import {
    send_payload,
    poll_envelopes,
    send_blob,
    poll_inbox,
} from '../src/core/slack/transport.js'

const CHANNEL = 'C_SEEQRETS'

async function collect(gen) {
    const out = []
    for await (const item of gen) out.push(item)
    return out
}

describe('transport typed envelopes', () => {
    it('send_payload + poll_envelopes round-trips a typed payload', async () => {
        const ws = new MockSlackWorkspace()
        const tl = ws.client('U_TL')
        const user = ws.client('U_USER')

        const payload = { username: 'bob@host', pubkey: 'PK', fingerprint: 'a1b2c' }
        await send_payload({
            client: tl,
            channel_id: CHANNEL,
            recipient_slack_user_id: 'U_USER',
            kind: MESSAGE_KINDS.introduction,
            payload,
        })

        const got = await collect(poll_envelopes({
            client: user,
            channel_id: CHANNEL,
            self_user_id: 'U_USER',
        }))

        expect(got).toHaveLength(1)
        expect(got[0].kind).toBe(MESSAGE_KINDS.introduction)
        expect(got[0].payload).toEqual(payload)
        expect(got[0].sender_user_id).toBe('U_TL')
        expect(got[0].file_id).toBeTruthy()
        expect(got[0].reply_ts).toBeTruthy()
    })

    it('only yields envelopes addressed to self', async () => {
        const ws = new MockSlackWorkspace()
        const tl = ws.client('U_TL')

        await send_payload({
            client: tl, channel_id: CHANNEL, recipient_slack_user_id: 'U_OTHER',
            kind: MESSAGE_KINDS.complete, payload: { ok: true },
        })

        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'),
            channel_id: CHANNEL,
            self_user_id: 'U_USER',
        }))
        expect(got).toHaveLength(0)
    })

    it('a legacy send_blob is seen by poll_envelopes as kind "secret"', async () => {
        const ws = new MockSlackWorkspace()
        const tl = ws.client('U_TL')

        const legacy = JSON.stringify({
            version: 1, from: 'alice', to: 'bob', secrets: [], signature: 'zzzzz',
        })
        await send_blob({
            client: tl, channel_id: CHANNEL,
            recipient_slack_user_id: 'U_USER', ciphertext: legacy,
        })

        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        expect(got).toHaveLength(1)
        expect(got[0].kind).toBe(MESSAGE_KINDS.secret)
        expect(got[0].payload.from).toBe('alice')
    })

    it('poll_inbox still works unchanged alongside poll_envelopes', async () => {
        const ws = new MockSlackWorkspace()
        await send_blob({
            client: ws.client('U_TL'), channel_id: CHANNEL,
            recipient_slack_user_id: 'U_USER', ciphertext: 'raw-bytes-here',
        })
        const frames = await collect(poll_inbox({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        expect(frames).toHaveLength(1)
        expect(frames[0].ciphertext.toString('utf-8')).toBe('raw-bytes-here')
    })
})
