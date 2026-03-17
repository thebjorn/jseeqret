/**
 * Server command group for headless vault initialization.
 */

import { Command } from 'commander'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { run_migrations } from '../../core/migrations.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../../core/crypto/utils.js'
import { encode_key } from '../../core/crypto/nacl.js'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { User } from '../../core/models/user.js'
import { harden_vault_windows } from '../../core/fileutils.js'

const server_init = new Command('init')
    .description('Initialize a vault for a headless server')
    .requiredOption('--email <email>', 'Your email address')
    .requiredOption('--pubkey <pubkey>', 'Your public key (base64)')
    .action(async (opts) => {
        const dirname = '/srv'
        const vault_dir = path.join(dirname, '.seeqret')

        if (!fs.existsSync(dirname)) {
            console.error(
                `Error: ${dirname} does not exist.`
            )
            process.exit(1)
        }

        if (fs.existsSync(vault_dir)) {
            const db_path = path.join(
                vault_dir, 'seeqrets.db',
            )
            if (fs.existsSync(db_path)) {
                console.error(
                    `Error: Vault already initialized`
                    + ` at ${vault_dir}.`
                    + ' Remove it first to re-initialize.'
                )
                process.exit(1)
            }

            try {
                fs.accessSync(vault_dir, fs.constants.W_OK)
            } catch {
                console.error(
                    `Error: ${vault_dir} is not writable.`
                )
                process.exit(1)
            }
        } else {
            fs.mkdirSync(vault_dir, {
                mode: 0o770, recursive: true,
            })
        }

        harden_vault_windows(vault_dir)

        // Use hostname as vault owner
        const owner = os.hostname().split('.')[0]
        const curuser = os.userInfo().username

        // Generate keys
        const key_pair = generate_and_save_key_pair(vault_dir)
        const owner_pubkey = encode_key(key_pair.publicKey)
        generate_symmetric_key(vault_dir)

        // Initialize database with hostname as owner
        await run_migrations(
            vault_dir, owner,
            `${owner}@${owner}`, owner_pubkey,
        )

        // Add the actual user
        const storage = new SqliteStorage(
            'seeqrets.db', vault_dir,
        )
        const user = new User(curuser, opts.email, opts.pubkey)
        await storage.add_user(user)

        console.log(`Server vault initialized in ${vault_dir}`)
        console.log(`Owner: ${owner}`)
        console.log(`User added: ${curuser}`)
        console.log(
            `\nSet the SEEQRET environment variable:`
        )
        console.log(`  export SEEQRET="${vault_dir}"`)
    })

export const server_commands = new Command('server')
    .description('Server vault management')

server_commands.addCommand(server_init)
