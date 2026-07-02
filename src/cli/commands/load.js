import fs from 'fs'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import {
    plan_secret_merge, apply_secret_merge, secret_id, MERGE_STRATEGIES,
} from '../../core/merge.js'
import { require_vault, resolve_user_or_exit } from '../utils.js'

function _fmt_ts(ts) {
    return ts ? new Date(ts * 1000).toISOString() : '(no timestamp)'
}

/**
 * Import secrets that were encrypted for this user with
 * `jseeqret export`. Accepts the blob either as a file (`--file`) or
 * inline (`--value`); `--from-user` selects which sender's public key
 * to verify against.
 *
 * Secrets that already exist locally with a DIFFERENT value are
 * conflicts: by default they are listed and nothing is imported.
 * `--strategy mine|theirs|newer` resolves them (`newer` compares the
 * modification timestamps carried by v006 exports; ties and missing
 * timestamps keep the local value).
 *
 * @example
 * jseeqret load -u alice -f alice-prod.json
 *
 * @example
 * jseeqret load -u alice -f alice-prod.json --strategy newer
 */
export const load_command = new Command('load')
    .description('Import exported secrets into the vault')
    .option('-u, --from-user <user>', 'Sender username')
    .option('-f, --file <path>', 'Path to exported file')
    .option('-v, --value <string>', 'Raw exported value string')
    .option('-s, --serializer <name>', 'Serializer to use', 'json-crypt')
    .option('--strategy <strategy>',
        'conflict resolution: mine, theirs, or newer (default: list & abort)')
    .action(async (opts) => {
        require_vault()

        if (!opts.file && !opts.value) {
            console.error('Error: Provide --file or --value.')
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
        const vault_dir = get_seeqret_dir()
        const receiver_private_key = decode_key(load_private_key_str(vault_dir))
        const SerializerClass = get_serializer(opts.serializer)

        let text
        if (opts.file) {
            text = fs.readFileSync(opts.file, 'utf-8')
        } else {
            text = opts.value
        }

        // Determine sender (accepts a bare or user@host name)
        let sender = null
        if (opts.fromUser) {
            sender = await resolve_user_or_exit(storage, opts.fromUser)
        } else if (opts.serializer === 'json-crypt') {
            // Try to determine sender from JSON payload
            const data = JSON.parse(text)
            if (data.from) {
                sender = await resolve_user_or_exit(storage, data.from)
            }
        }

        const serializer = new SerializerClass({
            sender,
            receiver_private_key,
        })

        const secrets = serializer.load(text)
        const plan = await plan_secret_merge(storage, secrets)

        if (plan.conflicts.length > 0 && !opts.strategy) {
            console.error(
                `${plan.conflicts.length} secret(s) already exist with a`
                + ' DIFFERENT value; nothing was imported:'
            )
            for (const c of plan.conflicts) {
                console.error(
                    `  ${secret_id(c.incoming)}`
                    + `  local ${_fmt_ts(c.local.updated_at)}`
                    + `  incoming ${_fmt_ts(c.incoming.updated_at)}`
                )
            }
            console.error(
                '\nRe-run with --strategy mine|theirs|newer to resolve.'
            )
            process.exitCode = 1
            return
        }

        const r = await apply_secret_merge(storage, plan, {
            strategy: opts.strategy || null,
        })
        console.log(
            `Imported ${r.added + r.updated} secret(s)`
            + ` (${r.added} added, ${r.updated} updated,`
            + ` ${r.kept} kept local, ${r.skipped} identical).`
        )
    })
