import { describe, it, expect, vi, beforeEach } from 'vitest'
import http from 'http'
import { URL } from 'url'

// Mock @slack/web-api so the PKCE token exchange never dials Slack.
const access_mock = vi.fn()
vi.mock('@slack/web-api', () => ({
    WebClient: class {
        constructor() {
            this.oauth = { v2: { access: access_mock } }
        }
    },
}))

const {
    run_oauth_flow,
    SLACK_CLIENT_ID,
    SLACK_USER_SCOPES,
    SLACK_REDIRECT_URL,
} = await import('../src/core/slack/oauth.js')

beforeEach(() => {
    access_mock.mockReset()
})

/** Fetch a loopback callback URL, swallowing the connection result. */
function hit(url) {
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            res.resume()
            res.on('end', () => resolve(res.statusCode))
        }).on('error', reject)
    })
}

/**
 * Drive run_oauth_flow by parsing the authorize URL it opens, pulling the
 * loopback port out of the `state`, and posting back a callback. Returns a
 * builder so each test decides what query string to send.
 */
function callback_from(authorize_url, { code, error, csrf_override } = {}) {
    const u = new URL(authorize_url)
    const state = u.searchParams.get('state')
    const [port, ...csrf_parts] = state.split('-')
    const csrf = csrf_override ?? csrf_parts.join('-')
    const cb = new URL(`http://127.0.0.1:${port}/callback`)
    cb.searchParams.set('state', `${port}-${csrf}`)
    if (code) cb.searchParams.set('code', code)
    if (error) cb.searchParams.set('error', error)
    return { url: cb.toString(), port }
}

describe('run_oauth_flow', () => {
    it('completes the PKCE loopback flow and returns identity', async () => {
        access_mock.mockResolvedValue({
            ok: true,
            authed_user: { id: 'U1', access_token: 'xoxp-real' },
            team: { id: 'T1', name: 'acme' },
        })

        let captured
        const open_browser = async url => {
            captured = url
            const { url: cb } = callback_from(url, { code: 'the-code' })
            await hit(cb)
        }

        const result = await run_oauth_flow({ open_browser })

        expect(result).toEqual({
            access_token: 'xoxp-real',
            team_id: 'T1',
            team_name: 'acme',
            user_id: 'U1',
            user_name: null,
        })

        // The authorize URL must carry the PKCE + scope parameters.
        const au = new URL(captured)
        expect(au.origin + au.pathname)
            .toBe('https://slack.com/oauth/v2/authorize')
        expect(au.searchParams.get('client_id')).toBe(SLACK_CLIENT_ID)
        expect(au.searchParams.get('user_scope')).toBe(SLACK_USER_SCOPES)
        expect(au.searchParams.get('redirect_uri')).toBe(SLACK_REDIRECT_URL)
        expect(au.searchParams.get('code_challenge_method')).toBe('S256')
        expect(au.searchParams.get('code_challenge')).toBeTruthy()

        // The exchange used a code_verifier, never a client secret.
        const exchange_args = access_mock.mock.calls[0][0]
        expect(exchange_args.code).toBe('the-code')
        expect(exchange_args.code_verifier).toBeTruthy()
        expect(exchange_args).not.toHaveProperty('client_secret')
    })

    it('falls back to top-level access_token when authed_user lacks one', async () => {
        access_mock.mockResolvedValue({
            ok: true,
            access_token: 'xoxp-top',
            authed_user: { id: 'U2' },
            team: { id: 'T2', name: 'team2' },
        })
        const open_browser = async url => {
            const { url: cb } = callback_from(url, { code: 'c' })
            await hit(cb)
        }
        const result = await run_oauth_flow({ open_browser })
        expect(result.access_token).toBe('xoxp-top')
        expect(result.user_id).toBe('U2')
    })

    // The rejection paths fire the callback without awaiting it: the
    // loopback handler must reject only after run_oauth_flow has set up its
    // Promise.race handler, otherwise the rejection is unhandled.
    it('rejects on a state mismatch', async () => {
        const open_browser = url => {
            const { url: cb } = callback_from(url, {
                code: 'c', csrf_override: 'tampered',
            })
            hit(cb).catch(() => {})
        }
        await expect(run_oauth_flow({ open_browser }))
            .rejects.toThrow(/state mismatch/)
        expect(access_mock).not.toHaveBeenCalled()
    })

    it('rejects when Slack redirects with an error param', async () => {
        const open_browser = url => {
            const { url: cb } = callback_from(url, { error: 'access_denied' })
            hit(cb).catch(() => {})
        }
        await expect(run_oauth_flow({ open_browser }))
            .rejects.toThrow(/access_denied/)
    })

    it('rejects when the callback carries no code', async () => {
        const open_browser = url => {
            const { url: cb } = callback_from(url, {})
            hit(cb).catch(() => {})
        }
        await expect(run_oauth_flow({ open_browser }))
            .rejects.toThrow(/missing code/)
    })

    it('404s unknown paths without resolving the flow', async () => {
        const open_browser = async url => {
            const u = new URL(url)
            const port = u.searchParams.get('state').split('-')[0]
            // A stray request to /favicon must not satisfy the wait.
            const status = await hit(`http://127.0.0.1:${port}/favicon.ico`)
            expect(status).toBe(404)
            // Now complete the flow properly.
            const { url: cb } = callback_from(url, { code: 'ok' })
            await hit(cb)
        }
        access_mock.mockResolvedValue({
            ok: true,
            authed_user: { id: 'U3', access_token: 'xoxp-z' },
            team: { id: 'T3', name: 't3' },
        })
        const result = await run_oauth_flow({ open_browser })
        expect(result.access_token).toBe('xoxp-z')
    })

    it('throws when oauth.v2.access reports failure', async () => {
        access_mock.mockResolvedValue({ ok: false, error: 'bad_code' })
        const open_browser = async url => {
            const { url: cb } = callback_from(url, { code: 'c' })
            await hit(cb)
        }
        await expect(run_oauth_flow({ open_browser }))
            .rejects.toThrow(/bad_code/)
    })

    it('throws when the response has no access token', async () => {
        access_mock.mockResolvedValue({
            ok: true,
            authed_user: { id: 'U4' },
            team: { id: 'T4', name: 't4' },
        })
        const open_browser = async url => {
            const { url: cb } = callback_from(url, { code: 'c' })
            await hit(cb)
        }
        await expect(run_oauth_flow({ open_browser }))
            .rejects.toThrow(/no user access_token/)
    })

    it('times out when no callback ever arrives', async () => {
        await expect(run_oauth_flow({
            open_browser: () => {},
            timeout_ms: 50,
        })).rejects.toThrow(/timed out/)
    })
})
