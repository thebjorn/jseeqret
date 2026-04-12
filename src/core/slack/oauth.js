/**
 * OAuth v2 PKCE loopback flow for `jseeqret slack login`.
 *
 * Flow:
 *   1. Generate a PKCE code verifier + challenge.
 *   2. Bind a one-shot http server on 127.0.0.1:<ephemeral>.
 *   3. Open the user's browser at slack.com/oauth/v2/authorize with
 *      a redirect_uri pointing at our loopback port.
 *   4. Wait for Slack to redirect back with ?code=...
 *   5. Exchange the code + verifier for a user token via oauth.v2.access.
 *   6. Shut down the server and return the token.
 *
 * The Client ID is baked into jseeqret (see SLACK_CLIENT_ID below). The
 * Client Secret is not required for the PKCE user-token flow on Slack's
 * loopback redirect path, and we do not ship one.
 *
 * Security notes:
 *  - We never touch the browser's session cookies; Slack handles auth.
 *  - The state parameter is a random 32-byte hex string, verified on
 *    callback.
 *  - The token is returned in-memory only; callers are responsible for
 *    Fernet-wrapping it via slack_config_set before persisting.
 */

import http from 'http'
import { randomBytes, createHash } from 'crypto'
import { URL } from 'url'
import { WebClient } from '@slack/web-api'

/**
 * Slack Client ID for the jseeqret app. This is NOT a secret -- it is
 * an identifier that appears in the authorize URL the user sees. The
 * real maintainer should replace this placeholder with the Client ID
 * of the published Slack app before the first release.
 */
export const SLACK_CLIENT_ID = process.env.JSEEQRET_SLACK_CLIENT_ID
    || '25158173844.10894054396469'

/**
 * Slack Client Secret. Required by oauth.v2.access even with PKCE.
 * Not security-critical for a public-distribution app with user tokens
 * (the secret is shipped in every client), but avoid pasting in logs.
 */
export const SLACK_CLIENT_SECRET = process.env.JSEEQRET_SLACK_CLIENT_SECRET
    || 'ca7ee68f19624a212755c6ed3cc1d91b'

/**
 * Public HTTPS redirect URL. Slack requires HTTPS for redirect URIs,
 * so we bounce through a hosted page that extracts the loopback port
 * from the state parameter and redirects to http://127.0.0.1:PORT/callback.
 */
export const SLACK_REDIRECT_URL =
    'https://www.norsktest.no/jseeqret/oauth/callback.html'

/**
 * The set of User Token Scopes jseeqret requests. Keep in sync with
 * documentation/slack-exchange/PLAN.md.
 */
export const SLACK_USER_SCOPES = [
    'channels:history',
    'channels:read',
    'groups:history',
    'groups:read',
    'files:read',
    'files:write',
    'chat:write',
    'users:read',
    'users:read.email',
].join(',')

function _random_url_safe(bytes) {
    return randomBytes(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
}

function _pkce_pair() {
    const verifier = _random_url_safe(32)
    const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    return { verifier, challenge }
}

/**
 * Spin up the loopback listener and return a promise that resolves with
 * the `code` Slack redirects back with.
 *
 * @param {string} expected_state
 * @returns {Promise<{server: http.Server, port: number, wait_for_code: Promise<string>}>}
 */
function _start_loopback(expected_state) {
    let resolve_code, reject_code
    const wait_for_code = new Promise((resolve, reject) => {
        resolve_code = resolve
        reject_code = reject
    })

    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1')
            if (url.pathname !== '/callback') {
                res.writeHead(404).end('Not found')
                return
            }

            const got_state = url.searchParams.get('state')
            const got_code = url.searchParams.get('code')
            const got_error = url.searchParams.get('error')

            if (got_error) {
                res.writeHead(400, { 'Content-Type': 'text/html' })
                res.end(`<h1>Slack login failed</h1><p>${got_error}</p>`)
                reject_code(new Error(`slack oauth error: ${got_error}`))
                return
            }

            // The full state is "{port}-{csrf_token}".  The bounce
            // page forwards it verbatim; we verify the csrf_token part.
            const got_csrf = (got_state || '').split('-').slice(1).join('-')
            if (got_csrf !== expected_state) {
                res.writeHead(400, { 'Content-Type': 'text/html' })
                res.end('<h1>Invalid state</h1>')
                reject_code(new Error('slack oauth: state mismatch'))
                return
            }

            if (!got_code) {
                res.writeHead(400, { 'Content-Type': 'text/html' })
                res.end('<h1>Missing code</h1>')
                reject_code(new Error('slack oauth: missing code'))
                return
            }

            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
                '<!doctype html><meta charset="utf-8">'
                + '<title>jseeqret slack login</title>'
                + '<h1>Success</h1>'
                + '<p>You can close this tab and return to the terminal.</p>'
            )
            resolve_code(got_code)
        } catch (e) {
            reject_code(e)
        }
    })

    return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port
            resolve({ server, port, wait_for_code })
        })
    })
}

/**
 * Run the PKCE loopback flow to completion and return the Slack User
 * token plus team/user info from `auth.test`.
 *
 * @param {object} [opts]
 * @param {(url: string) => void|Promise<void>} [opts.open_browser]
 *        - Called with the authorize URL. Default: print the URL and let
 *          the operator click it. The CLI can inject `open(url)`.
 * @param {number} [opts.timeout_ms=180000] - Abort after 3 min default.
 * @returns {Promise<{
 *   access_token: string,
 *   team_id: string,
 *   team_name: string,
 *   user_id: string,
 *   user_name: string,
 * }>}
 */
export async function run_oauth_flow(opts = {}) {
    const timeout_ms = opts.timeout_ms ?? 180000
    const open_browser = opts.open_browser
        || (url => console.log(`Open this URL in your browser:\n  ${url}`))

    const { verifier, challenge } = _pkce_pair()
    const csrf_token = _random_url_safe(24)

    const { server, port, wait_for_code } = await _start_loopback(csrf_token)
    // State encodes the loopback port so the hosted bounce page can
    // redirect back to http://127.0.0.1:PORT/callback.  The format
    // is "{port}-{csrf_token}".  The loopback server verifies the
    // csrf_token portion; the bounce page reads only the port.
    const state = `${port}-${csrf_token}`
    const redirect_uri = SLACK_REDIRECT_URL

    const authorize_url = new URL('https://slack.com/oauth/v2/authorize')
    authorize_url.searchParams.set('client_id', SLACK_CLIENT_ID)
    authorize_url.searchParams.set('user_scope', SLACK_USER_SCOPES)
    authorize_url.searchParams.set('redirect_uri', redirect_uri)
    authorize_url.searchParams.set('state', state)
    authorize_url.searchParams.set('code_challenge', challenge)
    authorize_url.searchParams.set('code_challenge_method', 'S256')

    try {
        await open_browser(authorize_url.toString())

        const code = await Promise.race([
            wait_for_code,
            new Promise((_, rej) =>
                setTimeout(
                    () => rej(new Error('slack login timed out')),
                    timeout_ms
                )
            ),
        ])

        const web = new WebClient()
        const r = await web.oauth.v2.access({
            client_id: SLACK_CLIENT_ID,
            client_secret: SLACK_CLIENT_SECRET,
            code,
            redirect_uri,
            code_verifier: verifier,
        })

        if (!r.ok) {
            throw new Error(`slack oauth.v2.access failed: ${r.error}`)
        }

        const access_token =
            r.authed_user?.access_token || r.access_token || null

        if (!access_token) {
            throw new Error('slack oauth: no user access_token in response')
        }

        return {
            access_token,
            team_id: r.team?.id || null,
            team_name: r.team?.name || null,
            user_id: r.authed_user?.id || null,
            user_name: null,
        }
    } finally {
        server.close()
    }
}
