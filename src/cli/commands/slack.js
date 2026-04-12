/**
 * `jseeqret slack ...` commands.
 *
 * This file is only a thin CLI wrapper around src/core/slack/*. All
 * security-sensitive logic (fingerprint verification, Fernet wrapping,
 * delete-on-import, doctor checks) lives in the core modules.
 */

import readline from 'readline'
import { Command } from 'commander'

import { SqliteStorage } from '../../core/sqlite-storage.js'
import { require_vault } from '../utils.js'
import { SlackClient } from '../../core/slack/client.js'
import { run_oauth_flow } from '../../core/slack/oauth.js'
import {
    SLACK_KEYS,
    slack_config_get,
    slack_config_set,
    slack_config_clear_all,
    slack_config_snapshot,
} from '../../core/slack/config.js'
import {
    bind_slack_handle,
    compute_fingerprint,
} from '../../core/slack/identity.js'
import { upgrade_db } from '../../core/migrations.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { createHash } from 'crypto'

/**
 * Prompt the operator for a single line of input.
 */
function _prompt(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question(question, (answer) => {
            rl.close()
            resolve(answer)
        })
    })
}

async function _load_client(storage) {
    const token = await slack_config_get(storage, SLACK_KEYS.user_token)
    if (!token) {
        throw new Error(
            'Not logged in to Slack. Run: jseeqret slack login'
        )
    }
    return new SlackClient(token)
}

// ---- slack login ----

const slack_login = new Command('login')
    .description('OAuth login to Slack and pick an exchange channel')
    .action(async () => {
        require_vault()
        await upgrade_db(get_seeqret_dir())
        const storage = new SqliteStorage()

        console.log('Starting Slack OAuth flow...')
        const { open: open_url } = await import('./_open_browser.js')

        const auth = await run_oauth_flow({ open_browser: open_url })

        // Persist token + team info.
        await slack_config_set(storage, SLACK_KEYS.user_token, auth.access_token)
        await slack_config_set(storage, SLACK_KEYS.team_id, auth.team_id)
        await slack_config_set(storage, SLACK_KEYS.team_name, auth.team_name)
        await slack_config_set(storage, SLACK_KEYS.user_id, auth.user_id)
        await slack_config_set(
            storage,
            SLACK_KEYS.token_created_at,
            Math.floor(Date.now() / 1000)
        )

        console.log(`Authenticated as <@${auth.user_id}> in ${auth.team_name}.`)

        // Confirm who we are and pick a channel.
        const client = new SlackClient(auth.access_token)
        const who = await client.auth_test()
        console.log(`auth.test -> ${who.user_name} (${who.team_name})`)

        const channels = await client.list_private_channels()
        if (channels.length === 0) {
            console.error(
                'No private channels found for this user.'
                + ' Create #seeqrets and invite yourself, then re-run.'
            )
            process.exit(1)
        }

        console.log('\nPrivate channels:')
        channels.forEach((c, i) => console.log(`  [${i + 1}] #${c.name}`))

        const pick = await _prompt(
            `\nPick the exchange channel [1-${channels.length}] `
            + `(default: first 'seeqrets' match): `
        )

        let chosen
        if (pick.trim()) {
            const idx = parseInt(pick.trim(), 10) - 1
            if (idx < 0 || idx >= channels.length) {
                console.error('Invalid selection.')
                process.exit(1)
            }
            chosen = channels[idx]
        } else {
            chosen = channels.find(c => c.name === 'seeqrets') || channels[0]
        }

        await slack_config_set(storage, SLACK_KEYS.channel_id, chosen.id)
        await slack_config_set(storage, SLACK_KEYS.channel_name, chosen.name)

        console.log(`\nOK. Exchange channel set to #${chosen.name} (${chosen.id}).`)
        console.log('Next: run `jseeqret slack doctor` before sending.')

        // The Slack WebClient keeps an HTTP agent alive; force a clean exit.
        process.exit(0)
    })

// ---- slack logout ----

const slack_logout = new Command('logout')
    .description('Wipe all Slack configuration from the vault')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        await slack_config_clear_all(storage)
        console.log('Slack configuration cleared.')
    })

// ---- slack status ----

const slack_status = new Command('status')
    .description('Show Slack login / channel / last-seen state')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const snap = await slack_config_snapshot(storage)

        if (!snap.user_token) {
            console.log('Not logged in. Run: jseeqret slack login')
            return
        }

        const token_age = snap.token_created_at
            ? Math.floor((Date.now() / 1000 - snap.token_created_at) / 86400)
            : null

        console.log(`team:         ${snap.team_name || '?'} (${snap.team_id || '?'})`)
        console.log(`user_id:      ${snap.user_id || '?'}`)
        console.log(`channel:      #${snap.channel_name || '?'} (${snap.channel_id || '?'})`)
        console.log(`last_seen_ts: ${snap.last_seen_ts || '(none)'}`)
        console.log(`token age:    ${token_age != null ? token_age + ' days' : '(unknown)'}`)
    })

// ---- slack link ----

const slack_link = new Command('link')
    .description('Bind a local user to a Slack handle after fingerprint confirmation')
    .argument('<username>', 'local user in the vault')
    .option('--handle <handle>', 'Slack handle without the @', null)
    .action(async (username, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        const local = await storage.fetch_user(username)
        if (!local) {
            console.error(`Error: local user '${username}' not found.`)
            process.exit(1)
        }

        const fp = compute_fingerprint(local)

        const handle = opts.handle || username
        console.log(`\nLocal user: ${username} <${local.email}>`)
        console.log(`Slack handle: @${handle}`)
        console.log(`Public key fingerprint: ${fp}`)
        console.log(
            '\nConfirm OUT-OF-BAND (voice, in-person, not via Slack) that'
            + ' the fingerprint above matches what the other party sees'
            + ' locally in their vault.'
        )

        const answer = await _prompt(
            `Type "${fp}" to confirm you have verified this fingerprint: `
        )

        if (answer.trim() !== fp) {
            console.error('Fingerprint confirmation mismatch. Refusing to bind.')
            process.exit(1)
        }

        await bind_slack_handle(storage, username, handle)
        console.log(`Bound ${username} -> @${handle} (fingerprint ${fp}).`)
    })

// ---- slack doctor ----

/**
 * Run every preflight check `send` and `receive` rely on. Exits 0 if
 * every check passes, non-zero otherwise. `--accept` re-baselines the
 * connected-apps hash and re-stamps the MFA attestation.
 */
const slack_doctor = new Command('doctor')
    .description('Preflight health check for the Slack exchange transport')
    .option('--accept', 're-baseline connected-apps + MFA attestation', false)
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const snap = await slack_config_snapshot(storage)

        const results = []
        const check = (label, ok, detail = '') => {
            results.push({ label, ok, detail })
        }

        if (!snap.user_token) {
            check('logged in', false, 'run: jseeqret slack login')
        } else {
            check('logged in', true, `as user ${snap.user_id}`)
        }

        const token_age_days = snap.token_created_at
            ? Math.floor((Date.now() / 1000 - snap.token_created_at) / 86400)
            : null
        check(
            'token age <= 90 days',
            token_age_days == null ? false : token_age_days <= 90,
            token_age_days == null
                ? 'no token_created_at stamp'
                : `${token_age_days} days old`
        )

        if (!snap.channel_id) {
            check('channel configured', false, 'run: jseeqret slack login')
        } else {
            check('channel configured', true, `#${snap.channel_name}`)
        }

        // Fingerprint freshness: every linked user must have been verified
        // in the last 180 days.
        const users = await storage.fetch_users({})
        const linked = users.filter(u => u.slack_handle)
        const stale = linked.filter(u => {
            if (!u.slack_verified_at) return true
            const age = Math.floor((Date.now() / 1000 - u.slack_verified_at) / 86400)
            return age > 180
        })
        check(
            'linked users verified in last 180 days',
            linked.length > 0 && stale.length === 0,
            linked.length === 0
                ? 'no linked users'
                : stale.length === 0
                    ? `${linked.length} linked, all fresh`
                    : `stale: ${stale.map(u => u.username).join(', ')}`
        )

        // Fingerprint-stored-matches-current for every linked user.
        const drifted = linked.filter(
            u => compute_fingerprint(u) !== u.slack_key_fingerprint
        )
        check(
            'stored fingerprints match current pubkeys',
            drifted.length === 0,
            drifted.length === 0
                ? 'ok'
                : `drift: ${drifted.map(u => u.username).join(', ')}`
        )

        // MFA attestation -- operator promise, re-prompted every 90 days.
        const mfa_age = snap.mfa_attested_at
            ? Math.floor((Date.now() / 1000 - snap.mfa_attested_at) / 86400)
            : null
        check(
            'workspace SSO + hardware MFA attested (<= 90 days)',
            mfa_age != null && mfa_age <= 90,
            mfa_age == null
                ? 're-run with --accept to attest'
                : `${mfa_age} days old`
        )

        // Connected-apps baseline -- warn on first change, fail thereafter.
        let apps_result = 'skipped'
        if (snap.user_token) {
            try {
                const client = new SlackClient(snap.user_token)
                const apps = await client.list_connected_apps()
                const h = createHash('sha256')
                    .update(JSON.stringify(apps.map(a => a.id || a.name).sort()))
                    .digest('hex')
                if (!snap.connected_apps_hash) {
                    apps_result = 'no baseline (run --accept to set)'
                    check('connected-apps baseline', false, apps_result)
                } else if (snap.connected_apps_hash === h) {
                    apps_result = 'unchanged'
                    check('connected-apps unchanged', true, apps_result)
                } else {
                    apps_result = 'CHANGED since last baseline'
                    check('connected-apps unchanged', false, apps_result)
                }

                if (opts.accept) {
                    await slack_config_set(
                        storage,
                        SLACK_KEYS.connected_apps_hash,
                        h
                    )
                    apps_result += ' (re-baselined)'
                }
            } catch (e) {
                check('connected-apps unchanged', false, `error: ${e.message}`)
            }
        }

        if (opts.accept) {
            const ans = await _prompt(
                'Confirm workspace enforces SSO + hardware MFA [yes/no]: '
            )
            if (ans.trim().toLowerCase() === 'yes') {
                await slack_config_set(
                    storage,
                    SLACK_KEYS.mfa_attested_at,
                    Math.floor(Date.now() / 1000)
                )
                console.log('MFA attestation recorded.')
            } else {
                console.log('MFA attestation NOT recorded.')
            }
        }

        // Print results.
        let all_ok = true
        for (const r of results) {
            const mark = r.ok ? '[ok]  ' : '[FAIL]'
            console.log(`${mark} ${r.label}${r.detail ? ' — ' + r.detail : ''}`)
            if (!r.ok) all_ok = false
        }

        if (!all_ok) {
            console.error('\nslack doctor: one or more checks failed.')
            process.exit(1)
        }

        console.log('\nslack doctor: all checks passed.')
        process.exit(0)
    })

// ---- group ----

export const slack_commands = new Command('slack')
    .description('Slack-based secret exchange transport')

slack_commands.addCommand(slack_login)
slack_commands.addCommand(slack_logout)
slack_commands.addCommand(slack_status)
slack_commands.addCommand(slack_link)
slack_commands.addCommand(slack_doctor)
