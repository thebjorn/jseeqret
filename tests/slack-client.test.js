import { describe, it, expect, vi } from 'vitest'
import { SlackClient } from '../src/core/slack/client.js'

/**
 * Build a SlackClient with its underlying WebClient swapped for a plain
 * object. The constructor still validates the token, then we override
 * `.web` so we exercise the wrapper's normalization logic in isolation.
 */
function client_with_web(web) {
    const c = new SlackClient('xoxp-test-token')
    c.web = web
    return c
}

describe('SlackClient constructor', () => {
    it('throws when no token is supplied', () => {
        expect(() => new SlackClient('')).toThrow(/missing OAuth token/)
        expect(() => new SlackClient(null)).toThrow(/missing OAuth token/)
    })

    it('keeps the token for authenticated downloads', () => {
        const c = new SlackClient('xoxp-keepme')
        expect(c.token).toBe('xoxp-keepme')
    })
})

describe('auth_test', () => {
    it('normalizes auth.test into a flat shape', async () => {
        const c = client_with_web({
            auth: {
                test: async () => ({
                    ok: true,
                    team_id: 'T1',
                    team: 'acme',
                    user_id: 'U1',
                    user: 'alice',
                    url: 'https://acme.slack.com',
                }),
            },
        })
        expect(await c.auth_test()).toEqual({
            ok: true,
            team_id: 'T1',
            team_name: 'acme',
            user_id: 'U1',
            user_name: 'alice',
            url: 'https://acme.slack.com',
        })
    })
})

describe('list_private_channels', () => {
    it('keeps only channels the user is a member of', async () => {
        const c = client_with_web({
            conversations: {
                list: async () => ({
                    channels: [
                        { id: 'C1', name: 'seeqrets', is_member: true },
                        { id: 'C2', name: 'other', is_member: false },
                        { id: 'C3', name: 'team', is_member: true },
                    ],
                }),
            },
        })
        expect(await c.list_private_channels()).toEqual([
            { id: 'C1', name: 'seeqrets' },
            { id: 'C3', name: 'team' },
        ])
    })

    it('tolerates a missing channels array', async () => {
        const c = client_with_web({
            conversations: { list: async () => ({}) },
        })
        expect(await c.list_private_channels()).toEqual([])
    })
})

describe('lookup_user_by_email', () => {
    it('returns a normalized user on a hit', async () => {
        const c = client_with_web({
            users: {
                lookupByEmail: async () => ({
                    user: { id: 'U9', name: 'bob', real_name: 'Bob Smith' },
                }),
            },
        })
        expect(await c.lookup_user_by_email('bob@acme.com')).toEqual({
            id: 'U9',
            name: 'bob',
            real_name: 'Bob Smith',
        })
    })

    it('returns null when Slack reports users_not_found', async () => {
        const c = client_with_web({
            users: {
                lookupByEmail: async () => {
                    const err = new Error('not found')
                    err.data = { error: 'users_not_found' }
                    throw err
                },
            },
        })
        expect(await c.lookup_user_by_email('ghost@acme.com')).toBeNull()
    })

    it('rethrows unexpected errors', async () => {
        const c = client_with_web({
            users: {
                lookupByEmail: async () => {
                    const err = new Error('rate limited')
                    err.data = { error: 'ratelimited' }
                    throw err
                },
            },
        })
        await expect(c.lookup_user_by_email('x@acme.com'))
            .rejects.toThrow(/rate limited/)
    })

    it('returns null when the response has no user', async () => {
        const c = client_with_web({
            users: { lookupByEmail: async () => ({}) },
        })
        expect(await c.lookup_user_by_email('x@acme.com')).toBeNull()
    })
})

describe('upload_blob', () => {
    it('extracts file id and thread ts from the nested share shape', async () => {
        const upload = vi.fn(async () => ({
            files: [{
                files: [{
                    id: 'F1',
                    shares: { private: { C1: [{ ts: '111.222' }] } },
                }],
            }],
        }))
        const c = client_with_web({ files: { uploadV2: upload } })
        const out = await c.upload_blob({
            channel_id: 'C1',
            filename: 'jsenc-x.bin',
            content_bytes: Buffer.from('padded'),
        })
        expect(out).toEqual({ file_id: 'F1', channel_id: 'C1', ts: '111.222' })
        // Title must stay empty so we never leak secret metadata.
        expect(upload.mock.calls[0][0].title).toBe('')
    })

    // Regression (real-Slack onboarding failure): uploadV2 shares the
    // file into the channel ASYNCHRONOUSLY, so the immediate response
    // carries an empty `shares`. The old fallback used file.timestamp --
    // a creation time, not a message ts -- which anchored the recipient
    // mention outside the file's thread; the poller never matched any
    // envelope sent over real Slack.
    it('polls files.info until the share message ts appears', async () => {
        let info_calls = 0
        const c = client_with_web({
            files: {
                uploadV2: async () => ({
                    file: { id: 'F2', timestamp: 1700000000, shares: {} },
                }),
                info: async () => {
                    info_calls += 1
                    return {
                        file: {
                            id: 'F2',
                            timestamp: 1700000000,
                            shares: info_calls >= 3
                                ? { private: { C1: [{ ts: '1700000001.000100' }] } }
                                : {},
                        },
                    }
                },
            },
        })
        c.share_poll_delay_ms = 1
        const out = await c.upload_blob({
            channel_id: 'C1',
            filename: 'f.bin',
            content_bytes: Buffer.from('x'),
        })
        expect(out.ts).toBe('1700000001.000100')
        expect(info_calls).toBe(3)
    })

    it('returns null ts (never file.timestamp) when the share never appears', async () => {
        const c = client_with_web({
            files: {
                uploadV2: async () => ({
                    file: { id: 'F2', timestamp: 1700000000 },
                }),
                info: async () => ({
                    file: { id: 'F2', timestamp: 1700000000, shares: {} },
                }),
            },
        })
        c.share_poll_attempts = 3
        c.share_poll_delay_ms = 1
        const out = await c.upload_blob({
            channel_id: 'C1',
            filename: 'f.bin',
            content_bytes: Buffer.from('x'),
        })
        // send_blob fails closed on a null ts; a creation-time ts here
        // would silently detach the mention from the file's thread.
        expect(out.ts).toBeNull()
    })

    it('throws when no file info is returned', async () => {
        const c = client_with_web({
            files: { uploadV2: async () => ({}) },
        })
        await expect(c.upload_blob({
            channel_id: 'C1',
            filename: 'f.bin',
            content_bytes: Buffer.from('x'),
        })).rejects.toThrow(/no file info/)
    })
})

describe('post_thread_reply', () => {
    it('posts into a thread and returns the new ts', async () => {
        const post = vi.fn(async () => ({ ts: '999.000' }))
        const c = client_with_web({ chat: { postMessage: post } })
        expect(await c.post_thread_reply({
            channel_id: 'C1',
            thread_ts: '111.000',
            text: 'hi',
        })).toEqual({ ts: '999.000' })
        expect(post).toHaveBeenCalledWith({
            channel: 'C1',
            thread_ts: '111.000',
            text: 'hi',
        })
    })
})

describe('conversations_history', () => {
    it('pages through cursors and returns oldest-first', async () => {
        const pages = [
            {
                messages: [{ ts: '3' }, { ts: '2' }],
                response_metadata: { next_cursor: 'c2' },
            },
            { messages: [{ ts: '1' }] },
        ]
        let call = 0
        const c = client_with_web({
            conversations: {
                history: async () => pages[call++],
            },
        })
        const out = await c.conversations_history({ channel_id: 'C1' })
        expect(out.map(m => m.ts)).toEqual(['1', '2', '3'])
    })

    it('tolerates a page with no messages', async () => {
        const c = client_with_web({
            conversations: { history: async () => ({}) },
        })
        expect(await c.conversations_history({ channel_id: 'C1' })).toEqual([])
    })
})

describe('file_info', () => {
    it('normalizes the file metadata', async () => {
        const c = client_with_web({
            files: {
                info: async () => ({
                    file: {
                        id: 'F1',
                        url_private: 'https://files.slack.com/F1',
                        size: 42,
                        name: 'f.bin',
                    },
                }),
            },
        })
        expect(await c.file_info('F1')).toEqual({
            id: 'F1',
            url_private: 'https://files.slack.com/F1',
            size: 42,
            name: 'f.bin',
        })
    })

    it('throws when the file is missing', async () => {
        const c = client_with_web({
            files: { info: async () => ({}) },
        })
        await expect(c.file_info('Fx')).rejects.toThrow(/no file for Fx/)
    })
})

describe('download_file', () => {
    it('fetches bytes with a bearer token', async () => {
        const fetch_mock = vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => new TextEncoder().encode('blob').buffer,
        }))
        vi.stubGlobal('fetch', fetch_mock)
        try {
            const c = client_with_web({})
            const buf = await c.download_file('https://files.slack.com/p')
            expect(buf.toString('utf-8')).toBe('blob')
            expect(fetch_mock).toHaveBeenCalledWith(
                'https://files.slack.com/p',
                { headers: { Authorization: 'Bearer xoxp-test-token' } }
            )
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('throws on a non-ok response', async () => {
        vi.stubGlobal('fetch', async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
        }))
        try {
            const c = client_with_web({})
            await expect(c.download_file('https://files.slack.com/p'))
                .rejects.toThrow(/403 Forbidden/)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('delete_file / delete_message', () => {
    it('delegates deletes to the web client', async () => {
        const del_file = vi.fn(async () => ({ ok: true }))
        const del_msg = vi.fn(async () => ({ ok: true }))
        const c = client_with_web({
            files: { delete: del_file },
            chat: { delete: del_msg },
        })
        await c.delete_file('F1')
        await c.delete_message({ channel_id: 'C1', ts: '1.2' })
        expect(del_file).toHaveBeenCalledWith({ file: 'F1' })
        expect(del_msg).toHaveBeenCalledWith({ channel: 'C1', ts: '1.2' })
    })
})

describe('list_connected_apps', () => {
    it('returns connections when the API exposes them', async () => {
        const c = client_with_web({
            apps: {
                connections: {
                    list: async () => ({ connections: [{ id: 'A1' }] }),
                },
            },
        })
        expect(await c.list_connected_apps()).toEqual([{ id: 'A1' }])
    })

    it('falls back to an empty list when the API is unavailable', async () => {
        const c = client_with_web({
            apps: {
                connections: {
                    list: async () => { throw new Error('not allowed') },
                },
            },
        })
        expect(await c.list_connected_apps()).toEqual([])
    })

    it('returns empty when the connections endpoint does not exist', async () => {
        const c = client_with_web({ apps: { connections: {} } })
        expect(await c.list_connected_apps()).toEqual([])
    })
})
