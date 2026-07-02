/**
 * Transport self-test: prove the send -> thread-mention -> poll-match ->
 * delete pipeline works against the CONNECTED Slack workspace, not just
 * the mock. Born from the share-ts incident (see tasks/lessons.md): the
 * mock returned a share ts synchronously, real Slack does not, and 400+
 * green tests proved the protocol while every real envelope was
 * invisible. This probe is the self-cleaning integration check: send a
 * `selftest` envelope to yourself, assert the poller matches it (which
 * exercises the exact thread structure the incident broke), then delete
 * the thread (own messages, so deletion must succeed).
 *
 * Carries only a random nonce -- never secrets.
 */

import { randomUUID } from 'crypto'
import { send_payload, poll_envelopes, delete_thread } from './transport.js'
import { MESSAGE_KINDS } from '../serializers/envelope.js'
import { trace } from '../trace.js'

/**
 * @param {import('./client.js').SlackClient} client
 * @param {object} opts
 * @param {string} opts.channel_id
 * @param {string} opts.self_user_id
 * @returns {Promise<{ok: boolean, sent: boolean, matched: boolean,
 *          deleted: boolean, error: string|null}>}
 */
export async function transport_selftest(client, { channel_id, self_user_id }) {
    const nonce = randomUUID()
    const result = {
        ok: false, sent: false, matched: false, deleted: false, error: null,
    }

    let sent
    try {
        sent = await send_payload({
            client,
            channel_id,
            recipient_slack_user_id: self_user_id,
            kind: MESSAGE_KINDS.selftest,
            payload: { nonce },
        })
        result.sent = true
    } catch (e) {
        result.error = `send failed: ${e.message}`
        return result
    }

    try {
        // Poll from just before our own envelope; the poller only matches
        // a file message whose thread carries our mention, so a match
        // proves the real thread structure end to end.
        const oldest = String(Number(sent.file_ts) - 1)
        for await (const env of poll_envelopes({
            client, channel_id, self_user_id, oldest_ts: oldest,
        })) {
            if (env.kind === MESSAGE_KINDS.selftest
                && env.payload?.nonce === nonce) {
                result.matched = true
                break
            }
        }
        if (!result.matched) {
            result.error = 'sent envelope was not matched by the poller'
                + ' (mention outside the file thread?)'
        }
    } catch (e) {
        result.error = `poll failed: ${e.message}`
    }

    try {
        await delete_thread({
            client, channel_id,
            file_id: sent.file_id, reply_ts: sent.reply_ts,
        })
        result.deleted = true
    } catch (e) {
        trace(`selftest cleanup failed: ${e.message}`)
        if (!result.error) result.error = `cleanup failed: ${e.message}`
    }

    result.ok = result.sent && result.matched && result.deleted
    return result
}
