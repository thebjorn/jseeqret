import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { run_migrations } from '../../core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../../core/crypto/utils.js'
import { encode_key } from '../../core/crypto/nacl.js'

export const init_command = new Command('init')
    .description('Initialize a new vault in DIR')
    .argument('[dir]', 'Directory to initialize vault in', '.')
    .requiredOption('--user <username>', 'Vault owner username')
    .requiredOption('--email <email>', 'Vault owner email')
    .option('--pubkey <pubkey>', 'Existing public key (base64)')
    .option('--key <key>', 'Existing symmetric key')
    .action(async (dir, opts) => {
        const dirname = path.resolve(dir)
        const vault_dir = path.join(dirname, 'seeqret')

        if (!fs.existsSync(dirname)) {
            console.error(`Error: Parent directory ${dirname} must exist.`)
            process.exit(1)
        }

        if (!fs.existsSync(vault_dir)) {
            fs.mkdirSync(vault_dir, { recursive: true })
        }

        // Generate or use provided symmetric key
        if (opts.key) {
            fs.writeFileSync(path.join(vault_dir, 'seeqret.key'), opts.key, 'utf-8')
        } else {
            generate_symmetric_key(vault_dir)
        }

        // Generate or use provided keypair
        let pubkey
        if (opts.pubkey) {
            pubkey = opts.pubkey
            fs.writeFileSync(path.join(vault_dir, 'public.key'), pubkey, 'utf-8')
        } else {
            const key_pair = generate_and_save_key_pair(vault_dir)
            pubkey = encode_key(key_pair.publicKey)
        }

        // Initialize database
        await run_migrations(vault_dir, opts.user, opts.email, pubkey)

        console.log(`Vault initialized in ${vault_dir}`)
        console.log(`\nSet the JSEEQRET environment variable:`)

        if (process.platform === 'win32') {
            console.log(`  setx JSEEQRET "${vault_dir}"`)
            console.log(`  set "JSEEQRET=${vault_dir}"`)
        } else {
            console.log(`  export JSEEQRET="${vault_dir}"`)
        }
    })
