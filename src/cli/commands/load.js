import fs from 'fs'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault, resolve_user_or_exit } from '../utils.js'

/**
 * Import secrets that were encrypted for this user with
 * `jseeqret export`. Accepts the blob either as a file (`--file`) or
 * inline (`--value`); `--from-user` selects which sender's public key
 * to verify against.
 *
 * @example
 * jseeqret load -u alice -f alice-prod.json
 */
export const load_command = new Command('load')
    .description('Import exported secrets into the vault')
    .option('-u, --from-user <user>', 'Sender username')
    .option('-f, --file <path>', 'Path to exported file')
    .option('-v, --value <string>', 'Raw exported value string')
    .option('-s, --serializer <name>', 'Serializer to use', 'json-crypt')
    .action(async (opts) => {
        require_vault()

        if (!opts.file && !opts.value) {
            console.error('Error: Provide --file or --value.')
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
        let count = 0
        for (const secret of secrets) {
            await storage.upsert_secret(secret)
            count++
        }

        console.log(`Imported ${count} secret(s).`)
    })
