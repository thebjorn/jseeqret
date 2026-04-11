/**
 * `jseeqret send <filter>... --to <user> --via slack|file`
 *
 * Dispatcher around two transports:
 *   --via file  : behaves exactly like the existing `export` command
 *                 (writes the serialized output to stdout or --out).
 *   --via slack : builds the same ciphertext blob, then pushes it
 *                 through src/core/slack/transport.js into the
 *                 configured exchange channel.
 *
 * Security guardrails (see documentation/slack-exchange/PLAN.md):
 *  - Refuses to send via Slack unless the recipient has been linked
 *    via `jseeqret slack link` and the stored fingerprint still
 *    matches the live pubkey.
 *  - Refuses to send if `slack doctor` has not been satisfied:
 *    checks token age, channel configuration, and MFA attestation.
 */

import fs from 'fs'
import { Command } from 'commander'

import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault } from '../utils.js'

import { SlackClient } from '../../core/slack/client.js'
import { send_blob } from '../../core/slack/transport.js'
import {
    SLACK_KEYS,
    slack_config_get,
    slack_config_snapshot,
} from '../../core/slack/config.js'
import { require_verified_binding } from '../../core/slack/identity.js'

/**
 * Build a ciphertext payload for `recipient` from the matching secrets.
 * Mirrors the `export` command's core, minus the I/O.
 */
async function _build_ciphertext(storage, filters_arr, recipient) {
    const admin = await storage.fetch_admin()
    const vault_dir = get_seeqret_dir()
    const sender_private_key = decode_key(load_private_key_str(vault_dir))
    const SerializerClass = get_serializer('json-crypt')

    const filters = filters_arr.length > 0 ? filters_arr : ['*:*:*']
    const all_secrets = []
    for (const f of filters) {
        const fspec = new FilterSpec(f)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        all_secrets.push(...secrets)
    }

    if (all_secrets.length === 0) {
        throw new Error('No matching secrets found.')
    }

    const serializer = new SerializerClass({
        sender: admin,
        receiver: recipient,
        sender_private_key,
    })

    return {
        ciphertext: serializer.dumps(all_secrets),
        count: all_secrets.length,
    }
}

/**
 * Quick preflight mirror of `slack doctor`'s minimum bar. Full doctor
 * runs are a separate command; this exists so `send` fails closed fast
 * without needing to dial Slack first.
 */
function _preflight_slack_cfg(snap) {
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

export const send_command = new Command('send')
    .description('Send encrypted secrets to a user via file or Slack')
    .argument('[filters...]', 'filter specs (app:env:key)')
    .requiredOption('--to <user>', 'recipient username in the local vault')
    .option('--via <transport>', 'transport: file or slack', 'file')
    .option('-o, --out <file>', 'output file path (file transport only)')
    .action(async (filters, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        const recipient = await storage.fetch_user(opts.to)
        if (!recipient) {
            console.error(`Error: user '${opts.to}' not found in vault.`)
            process.exit(1)
        }

        let ciphertext, count
        try {
            const r = await _build_ciphertext(storage, filters, recipient)
            ciphertext = r.ciphertext
            count = r.count
        } catch (e) {
            console.error(`Error: ${e.message}`)
            process.exit(1)
        }

        if (opts.via === 'file') {
            if (opts.out) {
                fs.writeFileSync(opts.out, ciphertext, 'utf-8')
                console.log(
                    `Exported ${count} secret(s) to ${opts.out} for ${opts.to}`
                )
            } else {
                console.log(ciphertext)
            }
            return
        }

        if (opts.via !== 'slack') {
            console.error(`Error: unknown transport '${opts.via}'`)
            process.exit(1)
        }

        // --- slack path ---
        try {
            await require_verified_binding(storage, opts.to)
        } catch (e) {
            console.error(`Error: ${e.message}`)
            process.exit(1)
        }

        const snap = await slack_config_snapshot(storage)
        const problems = _preflight_slack_cfg(snap)
        if (problems.length > 0) {
            console.error('Slack transport not ready:')
            for (const p of problems) console.error(`  - ${p}`)
            console.error('Run: jseeqret slack doctor')
            process.exit(1)
        }

        // Resolve the recipient's Slack user ID. We persist the Slack
        // handle at bind time but we DO re-resolve the user_id via the
        // API on every send, because slack handles can be recycled and
        // user_ids are the only stable identifier.
        const client = new SlackClient(snap.user_token)
        const slack_user = await client.lookup_user_by_email(recipient.email)
        if (!slack_user) {
            console.error(
                `Error: cannot resolve Slack user by email '${recipient.email}'.`
                + ' Make sure the recipient is in this workspace.'
            )
            process.exit(1)
        }

        try {
            const result = await send_blob({
                client,
                channel_id: snap.channel_id,
                recipient_slack_user_id: slack_user.id,
                ciphertext,
            })
            console.log(
                `Sent ${count} secret(s) to ${opts.to} via Slack`
                + ` (file ${result.file_id}, ts ${result.file_ts}).`
            )
        } catch (e) {
            console.error(`Error sending via Slack: ${e.message}`)
            process.exit(1)
        }
    })
