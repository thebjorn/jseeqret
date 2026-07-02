import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { require_vault, as_table } from '../utils.js'

/**
 * List users registered in the vault together with their public keys.
 * `--export` formats the list as ready-to-paste
 * `jseeqret add user ...` commands for provisioning a second vault.
 *
 * @example
 * jseeqret users
 *
 * @example
 * jseeqret users --export > provision-users.sh
 */
export const users_command = new Command('users')
    .description('List the users in the vault')
    .option('--export', 'Export users as add commands')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const users = await storage.fetch_users()

        if (opts.export) {
            for (const user of users) {
                const name = user.name ? ` --name "${user.name}"` : ''
                console.log(`jseeqret add user --username ${user.username} --email ${user.email} --pubkey ${user.pubkey}${name}`)
            }
        } else {
            as_table(
                'Name, Username, Email, PublicKey',
                users.map(u => [u.name || '', u.username, u.email, u.pubkey])
            )
        }
    })
