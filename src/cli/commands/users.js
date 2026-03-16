import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { require_vault, as_table } from '../utils.js'

export const users_command = new Command('users')
    .description('List the users in the vault')
    .option('--export', 'Export users as add commands')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const users = await storage.fetch_users()

        if (opts.export) {
            for (const user of users) {
                console.log(`jseeqret add user --username ${user.username} --email ${user.email} --pubkey ${user.pubkey}`)
            }
        } else {
            as_table('Username, Email, PublicKey', users)
        }
    })
