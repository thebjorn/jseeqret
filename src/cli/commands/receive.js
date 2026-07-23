/**
 * `jseeqret receive --via slack [--watch] [--interval <s>]`
 *
 * Polls the configured exchange channel, decrypts any secret blobs that
 * mention our Slack user_id in a thread reply, imports the secrets, then
 * deletes the Slack thread to honor forward secrecy (concerns #6 and #8).
 *
 * All transport/merge logic lives in src/core/slack/receive.js (shared
 * with the GUI Import page). This file is argument parsing and console
 * reporting only.
 *
 * Fail-closed rules (enforced in core):
 *  - On any API or decryption failure we DO NOT advance last_seen_ts
 *    and exit non-zero. The next run picks up from the same position.
 *  - A blob whose sender cannot be matched to a locally-linked user is
 *    treated as a failure (no silent skip) so a targeted attack from
 *    the channel is noisy rather than silent.
 *  - A blob that conflicts with local values imports nothing until a
 *    --strategy is given; its thread stays on Slack.
 */

import { Command } from 'commander'

import { SqliteStorage } from '../../core/sqlite-storage.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault } from '../utils.js'

import { SlackClient } from '../../core/slack/client.js'
import { receive_secrets } from '../../core/slack/receive.js'
import { slack_config_snapshot } from '../../core/slack/config.js'
import { MERGE_STRATEGIES } from '../../core/merge.js'

async function _run_once(storage, snap, strategy = null) {
    const client = new SlackClient(snap.user_token)
    const vault_dir = get_seeqret_dir()
    const receiver_private_key = decode_key(load_private_key_str(vault_dir))

    const r = await receive_secrets(storage, client, {
        channel_id: snap.channel_id,
        self_user_id: snap.user_id,
        oldest_ts: snap.last_seen_ts || '0',
        receiver_private_key,
        strategy,
    })

    if (r.needs_resolution) {
        const ids = r.conflicts.map(c => c.id)
        throw new Error(
            `blob from ${r.conflict_sender} conflicts with local values`
            + ` (${ids.join(', ')}). Re-run with`
            + ' --strategy mine|theirs|newer.'
        )
    }
    return r.imported
}

/**
 * Pull encrypted secret blobs from a configured transport and import
 * them into the vault. Currently supports `--via slack`; `--watch`
 * long-polls for new messages at `--interval` seconds.
 *
 * @example
 * jseeqret receive --via slack
 *
 * @example
 * jseeqret receive --via slack --watch --interval 15
 */
export const receive_command = new Command('receive')
    .description('Receive and import encrypted secrets from a transport')
    .option('--via <transport>', 'transport: slack', 'slack')
    .option('--watch', 'poll continuously until interrupted', false)
    .option('--interval <seconds>', 'poll interval in seconds (with --watch)', '30')
    .option('--strategy <strategy>',
        'conflict resolution: mine, theirs, or newer (default: fail closed)')
    .action(async (opts) => {
        require_vault()
        if (opts.via !== 'slack') {
            console.error(`Error: unknown transport '${opts.via}'`)
            process.exit(1)
        }
        if (opts.strategy && !MERGE_STRATEGIES.includes(opts.strategy)) {
            console.error(
                `Error: unknown strategy '${opts.strategy}'`
                + ` (expected ${MERGE_STRATEGIES.join('/')}).`
            )
            process.exit(1)
        }

        const storage = new SqliteStorage()
        const snap = await slack_config_snapshot(storage)
        if (!snap.user_token || !snap.channel_id || !snap.user_id) {
            console.error('Slack transport not configured. Run: jseeqret slack login')
            process.exit(1)
        }

        const interval_ms = parseInt(opts.interval, 10) * 1000

        const once = async () => {
            try {
                const n = await _run_once(storage, snap, opts.strategy || null)
                if (n > 0) {
                    console.log(`Imported ${n} secret(s) from Slack.`)
                }
            } catch (e) {
                console.error(`receive failed: ${e.message}`)
                if (!opts.watch) process.exit(1)
            }
        }

        await once()

        if (opts.watch) {
            console.log(`Watching Slack every ${opts.interval}s (Ctrl-C to stop).`)
            // Re-read the config on each tick so a concurrent `slack login`
            // rotation is picked up without a restart.
            const tick = async () => {
                const fresh = await slack_config_snapshot(storage)
                Object.assign(snap, fresh)
                await once()
            }
            setInterval(tick, interval_ms)
            // Keep the event loop alive; setInterval alone does not in
            // the presence of process.exit on failure above.
            await new Promise(() => {})
        }
    })
