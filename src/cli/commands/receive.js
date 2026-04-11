/**
 * `jseeqret receive --via slack [--watch] [--interval <s>]`
 *
 * Polls the configured exchange channel, decrypts any blobs that mention
 * our Slack user_id in a thread reply, imports the secrets, then deletes
 * the Slack thread to honor forward secrecy (concerns #6 and #8).
 *
 * Fail-closed rules:
 *  - On any API or decryption failure we DO NOT advance last_seen_ts
 *    and exit non-zero. The next run picks up from the same position.
 *  - A blob whose sender cannot be matched to a locally-linked user is
 *    treated as a failure (no silent skip) so a targeted attack from
 *    the channel is noisy rather than silent.
 */

import { Command } from 'commander'

import { SqliteStorage } from '../../core/sqlite-storage.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault } from '../utils.js'

import { SlackClient } from '../../core/slack/client.js'
import { poll_inbox, delete_thread } from '../../core/slack/transport.js'
import {
    SLACK_KEYS,
    slack_config_get,
    slack_config_set,
    slack_config_snapshot,
} from '../../core/slack/config.js'
import { find_user_by_slack_handle } from '../../core/slack/identity.js'

async function _run_once(storage, snap) {
    const client = new SlackClient(snap.user_token)
    const vault_dir = get_seeqret_dir()
    const receiver_private_key = decode_key(load_private_key_str(vault_dir))
    const SerializerClass = get_serializer('json-crypt')

    const oldest_ts = snap.last_seen_ts || '0'
    let imported = 0
    let highest_ts = oldest_ts

    for await (const msg of poll_inbox({
        client,
        channel_id: snap.channel_id,
        self_user_id: snap.user_id,
        oldest_ts,
    })) {
        // Resolve the sender: Slack user_id -> their username (via the
        // users.info API) -> local user record via slack_handle. This
        // extra step is what binds the ciphertext authentication (which
        // only proves "someone who holds sender.private_key wrote this")
        // to a Slack-visible identity.
        let slack_user
        try {
            const r = await client.web.users.info({ user: msg.sender_user_id })
            slack_user = r.user
        } catch (e) {
            throw new Error(
                `failed to resolve sender ${msg.sender_user_id}: ${e.message}`
            )
        }

        const sender = await find_user_by_slack_handle(storage, slack_user.name)
        if (!sender) {
            throw new Error(
                `inbound blob from unknown Slack handle '@${slack_user.name}'`
                + ` (user_id ${msg.sender_user_id}). Run:`
                + ` jseeqret slack link <local_user> --handle ${slack_user.name}`
            )
        }

        // Decrypt with json-crypt serializer.
        const serializer = new SerializerClass({
            sender,
            receiver_private_key,
        })
        const text = msg.ciphertext.toString('utf-8')
        const secrets = serializer.load(text)

        for (const secret of secrets) {
            await storage.add_secret(secret)
            imported++
        }

        // Delete the thread. If this fails we fall through and re-raise
        // so last_seen_ts is NOT advanced.
        await delete_thread({
            client,
            channel_id: snap.channel_id,
            file_id: msg.file_id,
            reply_ts: msg.reply_ts,
        })

        if (msg.file_ts > highest_ts) highest_ts = msg.file_ts
    }

    if (highest_ts !== oldest_ts) {
        await slack_config_set(storage, SLACK_KEYS.last_seen_ts, highest_ts)
    }

    return imported
}

export const receive_command = new Command('receive')
    .description('Receive and import encrypted secrets from a transport')
    .option('--via <transport>', 'transport: slack', 'slack')
    .option('--watch', 'poll continuously until interrupted', false)
    .option('--interval <seconds>', 'poll interval in seconds (with --watch)', '30')
    .action(async (opts) => {
        require_vault()
        if (opts.via !== 'slack') {
            console.error(`Error: unknown transport '${opts.via}'`)
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
                const n = await _run_once(storage, snap)
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
