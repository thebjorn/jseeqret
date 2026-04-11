/**
 * Slack transport for NaCl-encrypted export blobs.
 *
 * This module is purely about moving bytes across Slack. It does NOT
 * encrypt or decrypt -- that is still the job of the existing
 * json-crypt serializer in src/core/serializers/. The transport only:
 *
 *   send_blob       -- pads ciphertext, uploads as a file, posts a
 *                      recipient mention in the file's thread
 *   poll_inbox      -- walks history forward, yields { ts, file_id,
 *                      file_bytes, sender_user_id } for messages that
 *                      mention `self_user_id`
 *   delete_thread   -- files.delete + chat.delete, used after a
 *                      successful import to honor forward secrecy
 *
 * Fail-closed semantics (security-concerns.md #6, #8): on any Slack
 * error the caller must NOT advance `last_seen_ts` and must exit non-
 * zero. This module raises; `receive` in the CLI catches and reports.
 */

import { randomUUID } from 'crypto'
import { pad_to_bucket, unpad_from_bucket } from './padding.js'

/**
 * @param {object} opts
 * @param {import('./client.js').SlackClient} opts.client
 * @param {string} opts.channel_id
 * @param {string} opts.recipient_slack_user_id - e.g. "U01ABC..."
 * @param {Buffer|Uint8Array|string} opts.ciphertext
 *        - a NaCl-Box ciphertext payload produced by the existing
 *          export serializer. If string, treated as UTF-8.
 * @returns {Promise<{file_id: string, file_ts: string, reply_ts: string}>}
 */
export async function send_blob({ client, channel_id, recipient_slack_user_id, ciphertext }) {
    const payload_buf = typeof ciphertext === 'string'
        ? Buffer.from(ciphertext, 'utf-8')
        : Buffer.from(ciphertext)

    const padded = pad_to_bucket(payload_buf)
    const filename = `jsenc-${randomUUID()}.bin`

    const upload = await client.upload_blob({
        channel_id,
        filename,
        content_bytes: padded,
    })

    if (!upload.ts) {
        // We cannot post a thread reply without the file-share ts. Fail
        // closed and try to clean up the orphaned file so we don't leak
        // a naked ciphertext blob into the channel without a recipient.
        try {
            await client.delete_file(upload.file_id)
        } catch { /* best-effort */ }
        throw new Error(
            'slack upload did not return a file-share timestamp;'
            + ' aborting to avoid posting ciphertext without a recipient'
        )
    }

    // Concern #2: the thread body is ONLY the mention. No filename,
    // no app:env:key, no commentary.
    const reply = await client.post_thread_reply({
        channel_id,
        thread_ts: upload.ts,
        text: `<@${recipient_slack_user_id}>`,
    })

    return {
        file_id: upload.file_id,
        file_ts: upload.ts,
        reply_ts: reply.ts,
    }
}

/**
 * Poll the exchange channel for new blobs addressed to me.
 *
 * A message is "addressed to me" when its thread contains a reply whose
 * text is `<@SELF_USER_ID>`. We match on the exact mention token to avoid
 * false positives from free-form chatter.
 *
 * @param {object} opts
 * @param {import('./client.js').SlackClient} opts.client
 * @param {string} opts.channel_id
 * @param {string} opts.self_user_id
 * @param {string} [opts.oldest_ts='0']
 * @returns {AsyncGenerator<{
 *   file_ts: string,
 *   reply_ts: string,
 *   file_id: string,
 *   sender_user_id: string,
 *   ciphertext: Buffer,
 * }>}
 */
export async function* poll_inbox({
    client,
    channel_id,
    self_user_id,
    oldest_ts = '0',
}) {
    const messages = await client.conversations_history({
        channel_id,
        oldest_ts,
    })

    const self_mention = `<@${self_user_id}>`

    for (const msg of messages) {
        // We only care about file-share parents.
        const files = msg.files || []
        if (files.length === 0) continue

        // Only look at .bin files that match our naming convention --
        // everything else in the channel is out-of-band noise we should
        // ignore (concern #2's opaque naming rule is one-way, but in
        // practice we still want to skip unrelated files).
        const blob_file = files.find(f => (f.name || '').startsWith('jsenc-'))
        if (!blob_file) continue

        // Check the thread for a `<@self>` mention from some other user.
        const replies = await client.web.conversations.replies({
            channel: channel_id,
            ts: msg.ts,
        })
        const thread = (replies.messages || [])
        const mention = thread.find(
            m => m.ts !== msg.ts && (m.text || '').trim() === self_mention
        )
        if (!mention) continue

        const info = await client.file_info(blob_file.id)
        const raw = await client.download_file(info.url_private)
        const ciphertext = unpad_from_bucket(raw)

        yield {
            file_ts: msg.ts,
            reply_ts: mention.ts,
            file_id: blob_file.id,
            sender_user_id: msg.user,
            ciphertext,
        }
    }
}

/**
 * Delete both the uploaded file and the thread mention. Used by
 * `receive` after a successful local import to honor forward-secrecy.
 * Failure to delete is fatal: the caller must NOT advance `last_seen_ts`
 * or the same blob will be re-imported (and re-logged on Slack) forever.
 */
export async function delete_thread({ client, channel_id, file_id, reply_ts }) {
    await client.delete_message({ channel_id, ts: reply_ts })
    await client.delete_file(file_id)
}
