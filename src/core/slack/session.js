/**
 * Reusable Slack session helpers shared by the CLI and the Electron main
 * process. No new business logic lives here -- it factors out the OAuth
 * persistence, channel selection, and the minimal send/receive preflight
 * so the GUI bridge and the CLI drive exactly the same primitives.
 */

import { SlackClient } from './client.js'
import { run_oauth_flow } from './oauth.js'
import {
    SLACK_KEYS,
    slack_config_set,
    slack_config_snapshot,
} from './config.js'

/**
 * The minimum bar `send`/`receive` (and now onboarding) require before
 * touching Slack. Returns a list of human-readable problems; empty means
 * ready. Mirrors `slack doctor`'s critical subset so callers fail closed
 * fast without dialing Slack first.
 *
 * @param {object} snap - slack_config_snapshot() result
 * @returns {string[]}
 */
export function slack_preflight_problems(snap) {
    const problems = []
    if (!snap.user_token) problems.push('not logged in (jseeqret slack login)')
    if (!snap.channel_id) problems.push('no channel set')

    if (snap.token_created_at) {
        const age = Math.floor((Date.now() / 1000 - snap.token_created_at) / 86400)
        if (age > 90) problems.push(`token is ${age} days old (>90)`)
    }

    if (!snap.mfa_attested_at) {
        problems.push('MFA not attested (jseeqret slack doctor --accept)')
    } else {
        const age = Math.floor((Date.now() / 1000 - snap.mfa_attested_at) / 86400)
        if (age > 90) problems.push(`MFA attestation is ${age} days old (>90)`)
    }

    return problems
}

/**
 * Throw a single fail-closed error if the Slack session is not ready.
 * @param {object} snap - slack_config_snapshot() result
 */
export function assert_slack_ready(snap) {
    const problems = slack_preflight_problems(snap)
    if (problems.length > 0) {
        throw new Error(
            'Slack transport not ready:\n'
            + problems.map(p => `  - ${p}`).join('\n')
            + '\nRun: jseeqret slack doctor'
        )
    }
}

/**
 * Run the loopback OAuth flow and persist the token + identity. Does NOT
 * pick a channel -- the caller (CLI prompt or GUI picker) chooses from the
 * returned channel list and calls {@link slack_set_channel}.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {object} [opts]
 * @param {(url: string) => any} [opts.open_browser]
 * @returns {Promise<{user_id: string, team_name: string, team_id: string, channels: Array<{id: string, name: string}>}>}
 */
export async function slack_oauth_login(storage, opts = {}) {
    const auth = await run_oauth_flow({ open_browser: opts.open_browser })

    await slack_config_set(storage, SLACK_KEYS.user_token, auth.access_token)
    await slack_config_set(storage, SLACK_KEYS.team_id, auth.team_id)
    await slack_config_set(storage, SLACK_KEYS.team_name, auth.team_name)
    await slack_config_set(storage, SLACK_KEYS.user_id, auth.user_id)
    await slack_config_set(
        storage, SLACK_KEYS.token_created_at, Math.floor(Date.now() / 1000)
    )

    const client = new SlackClient(auth.access_token)
    const channels = await client.list_private_channels()

    return {
        user_id: auth.user_id,
        team_name: auth.team_name,
        team_id: auth.team_id,
        channels,
    }
}

/**
 * Persist the chosen exchange channel.
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} channel_id
 * @param {string} channel_name
 */
export async function slack_set_channel(storage, channel_id, channel_name) {
    await slack_config_set(storage, SLACK_KEYS.channel_id, channel_id)
    await slack_config_set(storage, SLACK_KEYS.channel_name, channel_name)
}

/**
 * Record the operator's MFA attestation -- a promise that the connected
 * workspace enforces SSO + hardware MFA. Stamps the current time so the
 * preflight passes for the next 90 days. This is the GUI counterpart to
 * `slack doctor --accept`; the caller is responsible for obtaining an
 * explicit confirmation before calling.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @returns {Promise<number>} the unix-seconds timestamp recorded
 */
export async function slack_attest_mfa(storage) {
    const now = Math.floor(Date.now() / 1000)
    await slack_config_set(storage, SLACK_KEYS.mfa_attested_at, now)
    return now
}

/**
 * A renderer-friendly summary of the current Slack session.
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @returns {Promise<object>}
 */
export async function slack_session_status(storage) {
    const snap = await slack_config_snapshot(storage)
    const token_age_days = snap.token_created_at
        ? Math.floor((Date.now() / 1000 - snap.token_created_at) / 86400)
        : null

    // Compute the preflight once. `needs_mfa_attest` is derived here, next
    // to the messages it keys off, so the GUI can route the operator to its
    // attest control rather than the CLI hint. Covers both "never attested"
    // and "attestation stale (>90 days)".
    const problems = slack_preflight_problems(snap)

    return {
        logged_in: !!snap.user_token,
        user_id: snap.user_id || null,
        team_name: snap.team_name || null,
        team_id: snap.team_id || null,
        channel_id: snap.channel_id || null,
        channel_name: snap.channel_name || null,
        last_seen_ts: snap.last_seen_ts || null,
        token_age_days,
        mfa_attested: !!snap.mfa_attested_at,
        needs_mfa_attest: problems.some(p => p.startsWith('MFA')),
        ready: problems.length === 0,
        problems,
    }
}
