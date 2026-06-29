/**
 * In-memory mock of the #seeqrets Slack channel for transport/onboarding
 * tests. One `MockSlackWorkspace` is a shared message store; each
 * `workspace.client(user_id)` returns a `SlackClient`-shaped object bound
 * to that user, implementing exactly the surface transport.js and the
 * onboarding primitives call.
 *
 * The mock stores the *padded* bytes handed to upload_blob and returns
 * them unchanged from download_file, so the real pad/unpad round-trip in
 * transport.js is exercised end to end.
 */

export class MockSlackWorkspace {
    constructor() {
        this.messages = []          // { ts, user, files?, text?, thread_ts? }
        this.files = {}             // file_id -> { id, name, bytes, url_private }
        this.directory = {}         // email -> { id, name }
        this._seq = 0
    }

    /** Register a workspace member so lookup_user_by_email resolves them. */
    register_member(email, id, name) {
        this.directory[email] = { id, name }
    }

    _next_id(prefix) {
        this._seq += 1
        return `${prefix}${this._seq}`
    }

    _next_ts() {
        this._seq += 1
        return `${1000 + this._seq}.000000`
    }

    client(user_id, user_name = null) {
        return new MockSlackClient(this, user_id, user_name)
    }
}

class MockSlackClient {
    constructor(workspace, user_id, user_name) {
        this.ws = workspace
        this.user_id = user_id
        this.user_name = user_name || user_id
        this.web = this._build_web()
    }

    async auth_test() {
        return {
            ok: true,
            team_id: 'T_MOCK',
            team_name: 'mockteam',
            user_id: this.user_id,
            user_name: this.user_name,
            url: 'https://mock.slack.com',
        }
    }

    async list_private_channels() {
        return [{ id: 'C_SEEQRETS', name: 'seeqrets' }]
    }

    async lookup_user_by_email(email) {
        const hit = this.ws.directory[email]
        if (!hit) return null
        return { id: hit.id, name: hit.name, real_name: hit.name }
    }

    async upload_blob({ channel_id, filename, content_bytes }) {
        const file_id = this.ws._next_id('F')
        const ts = this.ws._next_ts()
        this.ws.files[file_id] = {
            id: file_id,
            name: filename,
            bytes: Buffer.from(content_bytes),
            url_private: `mock://${file_id}`,
        }
        this.ws.messages.push({
            ts,
            user: this.user_id,
            files: [{ id: file_id, name: filename }],
            text: '',
        })
        return { file_id, channel_id, ts }
    }

    async post_thread_reply({ channel_id, thread_ts, text }) {
        const ts = this.ws._next_ts()
        this.ws.messages.push({ ts, user: this.user_id, text, thread_ts })
        return { ts }
    }

    async post_message({ channel_id, text }) {
        const ts = this.ws._next_ts()
        this.ws.messages.push({ ts, user: this.user_id, text })
        return { ts }
    }

    async conversations_history({ channel_id, oldest_ts = '0', limit = 100 }) {
        return this.ws.messages
            .filter(m => !m.thread_ts && m.files && Number(m.ts) > Number(oldest_ts))
            .sort((a, b) => Number(a.ts) - Number(b.ts))
            .slice(0, limit)
    }

    async file_info(file_id) {
        const f = this.ws.files[file_id]
        if (!f) throw new Error(`mock files.info: no file ${file_id}`)
        return { id: f.id, url_private: f.url_private, size: f.bytes.length, name: f.name }
    }

    async download_file(url_private) {
        const id = url_private.replace('mock://', '')
        const f = this.ws.files[id]
        if (!f) throw new Error(`mock download: no file at ${url_private}`)
        return Buffer.from(f.bytes)
    }

    async delete_file(file_id) {
        delete this.ws.files[file_id]
        this.ws.messages = this.ws.messages.filter(
            m => !(m.files && m.files[0] && m.files[0].id === file_id)
        )
    }

    async delete_message({ channel_id, ts }) {
        this.ws.messages = this.ws.messages.filter(m => m.ts !== ts)
    }

    _build_web() {
        const ws = this.ws
        return {
            conversations: {
                replies: async ({ channel, ts }) => {
                    const parent = ws.messages.find(m => m.ts === ts)
                    const replies = ws.messages.filter(m => m.thread_ts === ts)
                    return { messages: [parent, ...replies].filter(Boolean) }
                },
            },
            users: {
                info: async ({ user }) => ({ user: { id: user, name: user } }),
            },
        }
    }
}
