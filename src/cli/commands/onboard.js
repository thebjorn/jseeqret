/**
 * `jseeqret onboard ...` commands.
 *
 * Thin CLI wrappers over the core onboarding primitives in
 * src/core/onboarding.js -- the same primitives the Electron wizard and
 * Team Lead panel drive. No onboarding logic of its own: every subcommand
 * resolves the vault, the Slack session, and the local identity, then calls
 * one core function. All Slack-touching subcommands fail closed behind the
 * shared `slack doctor` preflight (Phase 8).
 *
 *   jseeqret onboard invite --email <e> --project <filter> [--name <n>]
 *   jseeqret onboard status
 *   jseeqret onboard watch [--once]
 *   jseeqret onboard join
 *   jseeqret onboard receive [--watch]
 *   jseeqret onboard approve <email>
 */

import readline from 'readline'
import { Command } from 'commander'

import { SqliteStorage } from '../../core/sqlite-storage.js'
import { require_vault } from '../utils.js'
import { fetch_self } from '../../core/user-resolve.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { SlackClient } from '../../core/slack/client.js'
import {
    SLACK_KEYS,
    slack_config_get,
    slack_config_set,
    slack_config_snapshot,
} from '../../core/slack/config.js'
import { assert_slack_ready } from '../../core/slack/session.js'
import { compute_fingerprint } from '../../core/slack/identity.js'
import {
    onboard_invite,
    onboard_poll,
    onboard_join,
    onboard_receive_invite,
    onboard_provision_poll,
    onboard_approve,
    expire_stale_onboarding,
    set_tl_trust,
    get_tl_trust,
    ONBOARDING_STATES,
} from '../../core/onboarding.js'

function _prompt(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin, output: process.stdout,
        })
        rl.question(question, (answer) => {
            rl.close()
            resolve(answer)
        })
    })
}

/**
 * Resolve the runtime context every Slack-touching subcommand needs:
 * storage, a SlackClient, the channel id, and the vault owner identity.
 * Throws (fail-closed) on a missing self or an unhealthy Slack session;
 * the caller turns that into a clean non-zero exit.
 */
async function _context() {
    require_vault()
    const storage = new SqliteStorage()

    const self = await fetch_self(storage)
    if (!self) {
        throw new Error('you are not registered in this vault.')
    }

    const snap = await slack_config_snapshot(storage)
    assert_slack_ready(snap)

    const client = new SlackClient(snap.user_token)
    return { storage, client, snap, self, channel_id: snap.channel_id }
}

/**
 * Report a fatal error and request a clean non-zero exit. We set
 * `process.exitCode` and let the event loop drain rather than calling
 * `process.exit()`, which can trip a libuv assertion on Windows when the
 * sql.js WASM module is loaded.
 */
function _fail(e) {
    console.error(`Error: ${e.message}`)
    process.exitCode = 1
}

// ---- onboard invite ----

const onboard_invite_cmd = new Command('invite')
    .description('Invite a new user (records state + posts an invite)')
    .requiredOption('--email <email>', 'invitee email')
    .requiredOption('--project <filter>', 'project FilterSpec, e.g. myapp:*:*')
    .option('--name <name>', 'optional display username')
    .action(async (opts) => {
        try {
            const { storage, client, self, channel_id } = await _context()
            const r = await onboard_invite(storage, client, {
                email: opts.email,
                project: opts.project,
                name: opts.name || null,
                channel_id,
                self,
            })
            console.log(`Invited ${opts.email} (slack ${r.slack_user_id}).`)
            console.log(`Your fingerprint to read on the voice call: ${compute_fingerprint(self)}`)
            process.exit(0)
        } catch (e) {
            _fail(e)
        }
    })

// ---- onboard status ----

const onboard_status_cmd = new Command('status')
    .description('List in-flight onboardings')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const rows = await storage.onboarding_list()
        if (rows.length === 0) {
            console.log('No onboardings in progress.')
            return
        }
        for (const r of rows) {
            const fp = r.fingerprint ? ` fp=${r.fingerprint}` : ''
            console.log(
                `${r.email.padEnd(28)} ${r.state.padEnd(12)}`
                + ` ${r.project_filter || ''}${fp}`
            )
        }
    })

// ---- onboard watch (TL) ----

const onboard_watch_cmd = new Command('watch')
    .description('Poll for introductions; promote invited -> introduced')
    .option('--once', 'run a single poll instead of looping', false)
    .option('--interval <seconds>', 'poll interval', '15')
    .action(async (opts) => {
        let ctx
        try {
            ctx = await _context()
        } catch (e) {
            _fail(e)
            return
        }
        const { storage, client, channel_id, snap } = ctx
        const self_user_id = snap.user_id

        const tick = async () => {
            await expire_stale_onboarding(storage)
            const oldest = await slack_config_get(storage, SLACK_KEYS.onboard_last_seen_ts) || '0'
            const r = await onboard_poll(storage, client, {
                channel_id, self_user_id, oldest_ts: oldest,
            })
            for (const ev of r.events) {
                if (ev.expected) {
                    console.log(`introduced: ${ev.email} (fingerprint ${ev.fingerprint})`)
                } else {
                    console.log(`WARNING: unexpected introduction from ${ev.email} — not invited`)
                }
            }
            if (r.highest_ts !== oldest) {
                await slack_config_set(storage, SLACK_KEYS.onboard_last_seen_ts, r.highest_ts)
            }
        }

        try {
            await tick()
        } catch (e) {
            _fail(e)
            return
        }
        if (opts.once) { process.exit(0) }

        const interval = Math.max(5, parseInt(opts.interval, 10) || 15) * 1000
        setInterval(() => { tick().catch(e => console.error(e.message)) }, interval)
    })

// ---- onboard join (user) ----

const onboard_join_cmd = new Command('join')
    .description('Read the invite, verify the TL fingerprint, introduce yourself')
    .action(async () => {
        try {
            const { storage, client, channel_id, snap, self } = await _context()
            const self_user_id = snap.user_id

            const invite = await onboard_receive_invite(storage, client, {
                channel_id, self_user_id,
            })
            if (!invite) {
                throw new Error(
                    'no invite found in the channel. Ask your team lead to invite you.'
                )
            }

            console.log(`Invite from team lead (slack ${invite.tl_slack_user_id}).`)
            console.log(`Team lead fingerprint: ${invite.tl_fingerprint}`)
            console.log(
                '\nConfirm OUT-OF-BAND (voice call, not Slack) that this fingerprint'
                + ' matches what your team lead reads aloud.'
            )
            const ans = await _prompt(`Type "${invite.tl_fingerprint}" to confirm: `)
            if (ans.trim() !== invite.tl_fingerprint) {
                throw new Error('fingerprint mismatch. Refusing to trust. Stop and re-verify.')
            }

            await set_tl_trust(storage, {
                user_id: invite.tl_slack_user_id,
                pubkey: invite.tl_pubkey,
                fingerprint: invite.tl_fingerprint,
                project: invite.project,
            })

            console.log(`\nYour fingerprint to read aloud: ${compute_fingerprint(self)}`)
            await onboard_join(storage, client, {
                channel_id, self, tl_slack_user_id: invite.tl_slack_user_id,
            })
            console.log('Introduction sent. Wait for approval, then run: jseeqret onboard receive')
            process.exit(0)
        } catch (e) {
            _fail(e)
        }
    })

// ---- onboard receive (user) ----

const onboard_receive_cmd = new Command('receive')
    .description('Import teammates + secrets once the TL has approved you')
    .action(async () => {
        try {
            const { storage, client, channel_id, snap } = await _context()
            const self_user_id = snap.user_id

            const trust = await get_tl_trust(storage)
            if (!trust.tl_pubkey) {
                throw new Error('no team-lead trust on file. Run: jseeqret onboard join')
            }

            const private_key = decode_key(load_private_key_str(get_seeqret_dir()))
            const r = await onboard_provision_poll(storage, client, {
                channel_id, self_user_id,
                receiver_private_key: private_key,
                trusted_pubkey: trust.tl_pubkey,
            })
            console.log(
                `Imported ${r.imported_users} teammate(s),`
                + ` ${r.imported_secrets} secret(s).`
            )
            console.log(r.complete ? "You're set up!" : 'Not approved yet — try again later.')
            process.exit(0)
        } catch (e) {
            _fail(e)
        }
    })

// ---- onboard approve (TL) ----

const onboard_approve_cmd = new Command('approve')
    .description('Approve an introduced user after verifying their fingerprint')
    .argument('<email>', 'the invitee email')
    .action(async (email) => {
        try {
            const { storage, client, channel_id, self } = await _context()

            const row = await storage.onboarding_get(email)
            if (!row) {
                throw new Error(`no onboarding in progress for ${email}.`)
            }
            if (row.state !== ONBOARDING_STATES.introduced) {
                throw new Error(`cannot approve ${email}: state is '${row.state}'.`)
            }

            console.log(`Captured fingerprint for ${email}: ${row.fingerprint}`)
            console.log('Verify this OUT-OF-BAND (voice call) before approving.')
            const ans = await _prompt(`Type "${row.fingerprint}" to approve: `)
            if (ans.trim() !== row.fingerprint) {
                throw new Error('fingerprint mismatch. Refusing to approve.')
            }

            const sender_private_key = decode_key(load_private_key_str(get_seeqret_dir()))
            const summary = await onboard_approve(storage, client, {
                email, verified: true, fingerprint: ans.trim(),
                channel_id, self, sender_private_key,
            })
            console.log(
                `Approved ${email}: sent ${summary.users_sent} user(s),`
                + ` ${summary.secrets_sent} secret(s),`
                + ` ${summary.broadcasts} broadcast(s).`
            )
            process.exit(0)
        } catch (e) {
            _fail(e)
        }
    })

// ---- group ----

export const onboard_commands = new Command('onboard')
    .description('Automated onboarding over the Slack exchange transport')

onboard_commands.addCommand(onboard_invite_cmd)
onboard_commands.addCommand(onboard_status_cmd)
onboard_commands.addCommand(onboard_watch_cmd)
onboard_commands.addCommand(onboard_join_cmd)
onboard_commands.addCommand(onboard_receive_cmd)
onboard_commands.addCommand(onboard_approve_cmd)
