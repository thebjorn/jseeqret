import fs from 'fs'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { get_serializer } from '../../core/serializers/index.js'
import { load_private_key_str } from '../../core/crypto/utils.js'
import { decode_key } from '../../core/crypto/nacl.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault } from '../utils.js'

export const export_command = new Command('export')
    .description('Export secrets encrypted for a user')
    .requiredOption('--to <user...>', 'Recipient username(s)')
    .option('-f, --filter <filter...>', 'Filter spec(s) (app:env:key)', [])
    .option('-s, --serializer <name>', 'Serializer to use', 'json-crypt')
    .option('-o, --out <file>', 'Output file path')
    .option('-w, --windows', 'Export in Windows format')
    .option('-l, --linux', 'Export in Linux format')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()
        const vault_dir = get_seeqret_dir()
        const sender_private_key = decode_key(load_private_key_str(vault_dir))
        const SerializerClass = get_serializer(opts.serializer)

        const filters = opts.filter.length > 0 ? opts.filter : ['*:*:*']

        // Collect all matching secrets across filters
        const all_secrets = []
        for (const f of filters) {
            const fspec = new FilterSpec(f)
            const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
            all_secrets.push(...secrets)
        }

        if (all_secrets.length === 0) {
            console.error('No matching secrets found.')
            process.exit(1)
        }

        for (const username of opts.to) {
            const receiver = await storage.fetch_user(username)
            if (!receiver) {
                console.error(`Error: User '${username}' not found in vault.`)
                process.exit(1)
            }

            const serializer = new SerializerClass({
                sender: admin,
                receiver,
                sender_private_key,
            })

            let system = null
            if (opts.windows) system = 'win32'
            if (opts.linux) system = 'linux'

            const output = serializer.dumps(all_secrets, system)

            if (opts.out) {
                fs.writeFileSync(opts.out, output, 'utf-8')
                console.log(`Exported ${all_secrets.length} secret(s) to ${opts.out} for ${username}`)
            } else {
                console.log(output)
            }
        }
    })
