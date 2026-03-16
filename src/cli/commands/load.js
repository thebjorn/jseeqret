import fs from 'fs'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault } from '../utils.js'

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

        // Determine sender
        let sender = null
        if (opts.fromUser) {
            sender = await storage.fetch_user(opts.fromUser)
            if (!sender) {
                console.error(`Error: User '${opts.fromUser}' not found in vault.`)
                process.exit(1)
            }
        } else if (opts.serializer === 'json-crypt') {
            // Try to determine sender from JSON payload
            const data = JSON.parse(text)
            if (data.from) {
                sender = await storage.fetch_user(data.from)
            }
        }

        const serializer = new SerializerClass({
            sender,
            receiver_private_key,
        })

        const secrets = serializer.load(text)
        let count = 0
        for (const secret of secrets) {
            await storage.add_secret(secret)
            count++
        }

        console.log(`Imported ${count} secret(s).`)
    })
