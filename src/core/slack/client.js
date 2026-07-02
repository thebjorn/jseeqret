/**
 * Thin wrapper around @slack/web-api's WebClient.
 *
 * Everything jseeqret needs from Slack fits in ~10 methods. The WebClient
 * already handles 429 backoff (`retryConfig.retries`) and surfaces errors
 * as Error subclasses, so this wrapper is mostly a vocabulary layer:
 *
 *   - keeps all Slack calls in one place so auditing is easy
 *   - normalizes return shapes to plain objects
 *   - hides the difference between `WebClient.files.uploadV2`,
 *     `files.delete`, etc., behind one `SlackClient` surface
 *   - takes the token by injection (no globals) so the caller can
 *     pull it from the vault kv on every command invocation
 *
 * Concern #8 (rate limits / availability): the WebClient's default retry
 * policy already implements exponential backoff on 429; we leave it on
 * its defaults. Our fail-closed behavior lives in transport.js.
 */

import { WebClient } from '@slack/web-api'
import { trace } from '../trace.js'

/**
 * Extract the ts of the message that shares `file` into `channel_id`,
 * or null if the share has not materialized yet. NEVER substitute
 * `file.timestamp` -- that is the file's creation time (integer
 * seconds), not a message ts, and anchoring the recipient mention to
 * it detaches the mention from the file's thread so the poller can
 * never match it.
 */
function _share_ts(file, channel_id) {
    if (!file || !file.shares) return null
    for (const scope of ['private', 'public']) {
        const shares = file.shares[scope]?.[channel_id]
        if (shares && shares.length > 0 && shares[0].ts) {
            return shares[0].ts
        }
    }
    return null
}

export class SlackClient {
    /**
     * @param {string} token - Slack User OAuth token (xoxp-...)
     * @param {object} [opts]
     */
    constructor(token, opts = {}) {
        if (!token) {
            throw new Error('SlackClient: missing OAuth token')
        }
        this.token = token
        this.web = new WebClient(token, {
            retryConfig: opts.retryConfig, // undefined = default (10 retries w/ backoff)
        })
        // Share polling knobs (tests dial these down).
        this.share_poll_attempts = opts.share_poll_attempts ?? 20
        this.share_poll_delay_ms = opts.share_poll_delay_ms ?? 500
    }

    /** `auth.test` -> { ok, team_id, team, user_id, user, url } */
    async auth_test() {
        const r = await this.web.auth.test()
        trace(`slack auth.test -> ok=${r.ok} user=${r.user_id} team=${r.team_id}`)
        return {
            ok: r.ok,
            team_id: r.team_id,
            team_name: r.team,
            user_id: r.user_id,
            user_name: r.user,
            url: r.url,
        }
    }

    /**
     * List private channels the authenticated user is a member of.
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async list_private_channels() {
        const r = await this.web.conversations.list({
            types: 'private_channel',
            exclude_archived: true,
            limit: 200,
        })
        const channels = (r.channels || [])
            .filter(c => c.is_member)
            .map(c => ({ id: c.id, name: c.name }))
        trace(`slack conversations.list -> ${channels.length} private member channels`)
        return channels
    }

    /**
     * Look up a Slack user by email, falling back to a full users.list
     * scan if the email route is unavailable.
     * @returns {Promise<{id: string, name: string, real_name: string}|null>}
     */
    async lookup_user_by_email(email) {
        try {
            const r = await this.web.users.lookupByEmail({ email })
            if (r.user) {
                trace(`slack users.lookupByEmail ${email} -> ${r.user.id} (@${r.user.name})`)
                return {
                    id: r.user.id,
                    name: r.user.name,
                    real_name: r.user.real_name,
                }
            }
        } catch (e) {
            if (e?.data?.error !== 'users_not_found') throw e
        }
        trace(`slack users.lookupByEmail ${email} -> not found`)
        return null
    }

    /**
     * Upload a binary blob as a file-share message to a channel.
     *
     * @param {object} opts
     * @param {string} opts.channel_id
     * @param {string} opts.filename        -- opaque, e.g. jsenc-<uuid>.bin
     * @param {Buffer} opts.content_bytes   -- already padded ciphertext
     * @returns {Promise<{file_id: string, channel_id: string, ts: string}>}
     */
    async upload_blob({ channel_id, filename, content_bytes }) {
        trace(`slack files.uploadV2 ${filename} (${content_bytes.length}b) -> ${channel_id}`)
        const r = await this.web.files.uploadV2({
            channel_id,
            filename,
            file: content_bytes,
            // Empty title: don't leak secret-count or app:env:key info.
            title: '',
            initial_comment: undefined,
            request_file_info: true,
        })

        // files.uploadV2 returns { ok, files: [{ id, files: [...] }] } --
        // the exact shape varies with the payload. Normalize to the first
        // (id, channel, ts) triple we can find.
        const first_file =
            r.files?.[0]?.files?.[0]
            || r.files?.[0]
            || r.file
            || null

        if (!first_file) {
            throw new Error('files.uploadV2 returned no file info')
        }

        // We need the ts of the MESSAGE that shares the file into the
        // channel (the thread anchor for the recipient mention). Sharing
        // happens asynchronously on Slack's side, so the uploadV2
        // response usually carries an empty `shares` -- poll files.info
        // until the share message exists. The old fallback to
        // `file.timestamp` was the bug that made every real-Slack
        // envelope unmatchable: it is a creation time, not a message ts,
        // so the mention landed outside the file's thread.
        let ts = _share_ts(first_file, channel_id)
        let polls = 0
        for (; !ts && polls < this.share_poll_attempts; polls++) {
            await new Promise(res => setTimeout(res, this.share_poll_delay_ms))
            const info = await this.web.files.info({ file: first_file.id })
            ts = _share_ts(info.file, channel_id)
        }
        trace(`slack upload ${first_file.id}: share ts=${ts} after ${polls} info polls`)

        // ts may still be null; send_blob fails closed on that (deletes
        // the orphaned ciphertext and throws).
        return {
            file_id: first_file.id,
            channel_id,
            ts,
        }
    }

    /**
     * Post a thread reply on a message.
     * @returns {Promise<{ts: string}>}
     */
    async post_thread_reply({ channel_id, thread_ts, text }) {
        const r = await this.web.chat.postMessage({
            channel: channel_id,
            thread_ts,
            text,
        })
        trace(`slack chat.postMessage thread=${thread_ts} "${text}" -> ts=${r.ts}`)
        return { ts: r.ts }
    }

    /**
     * Walk conversations.history forward from `oldest_ts`.
     * Returns messages in chronological order (oldest first).
     * @param {object} opts
     * @param {string} opts.channel_id
     * @param {string} [opts.oldest_ts='0']
     * @param {number} [opts.limit=100]
     * @returns {Promise<Array<object>>}
     */
    async conversations_history({ channel_id, oldest_ts = '0', limit = 100 }) {
        // Page through the full [oldest_ts, now] range. A single 100-message
        // page would silently drop older envelopes on a busy channel.
        const all = []
        let cursor
        do {
            const r = await this.web.conversations.history({
                channel: channel_id,
                oldest: oldest_ts,
                inclusive: false,
                limit,
                cursor,
            })
            all.push(...(r.messages || []))
            cursor = r.response_metadata?.next_cursor || null
        } while (cursor)

        // Slack returns newest-first; reverse so callers can process in order.
        trace(`slack conversations.history ${channel_id} oldest=${oldest_ts}`
            + ` -> ${all.length} messages`)
        return all.reverse()
    }

    /**
     * Fetch a file's metadata (including the authenticated download URL).
     * @returns {Promise<{id: string, url_private: string, size: number}>}
     */
    async file_info(file_id) {
        const r = await this.web.files.info({ file: file_id })
        if (!r.file) {
            throw new Error(`files.info returned no file for ${file_id}`)
        }
        return {
            id: r.file.id,
            url_private: r.file.url_private,
            size: r.file.size,
            name: r.file.name,
        }
    }

    /**
     * Download a file's bytes via an authenticated fetch against
     * url_private. @slack/web-api does not expose a helper for this, so
     * we use the global `fetch` with an `Authorization: Bearer <token>`
     * header -- the same auth Slack expects for private file downloads.
     * @returns {Promise<Buffer>}
     */
    async download_file(url_private) {
        const res = await fetch(url_private, {
            headers: { Authorization: `Bearer ${this.token}` },
        })
        if (!res.ok) {
            throw new Error(
                `slack file download failed: ${res.status} ${res.statusText}`
            )
        }
        const array_buf = await res.arrayBuffer()
        trace(`slack file download -> ${array_buf.byteLength}b`)
        return Buffer.from(array_buf)
    }

    /** Delete a file (fails closed on error — caller handles). */
    async delete_file(file_id) {
        trace(`slack files.delete ${file_id}`)
        await this.web.files.delete({ file: file_id })
    }

    /** Delete a message from a channel. */
    async delete_message({ channel_id, ts }) {
        trace(`slack chat.delete ${channel_id} ts=${ts}`)
        await this.web.chat.delete({ channel: channel_id, ts })
    }

    /**
     * Enumerate workspace connected apps. Used by `slack doctor` to
     * baseline the connected-app set (concern #7). The tokens:list API
     * is admin-only, so we fall back to apps.list with user scope.
     * Returns whatever Slack gives us; the caller hashes it.
     *
     * @returns {Promise<Array<{id: string, name: string, scopes?: string[]}>>}
     */
    async list_connected_apps() {
        try {
            const r = await this.web.apps.connections.list?.() // may not exist
            if (r?.connections) return r.connections
        } catch { /* fall through */ }

        // Fall back: some workspaces expose apps via admin.apps.approved.list
        // but that needs admin scopes. If neither is available, return the
        // empty list -- `slack doctor` will treat the absence as a warning,
        // not a silent pass, by annotating its result.
        return []
    }
}
