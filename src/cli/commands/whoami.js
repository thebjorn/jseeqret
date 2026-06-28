import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { qualified_user } from '../../core/vault.js'
import { fetch_self } from '../../core/user-resolve.js'
import { require_vault } from '../utils.js'

/**
 * Print the current user's name and their role — `(owner)` for the
 * vault admin, bare username for a registered member, or an
 * unregistered note otherwise. Useful for scripts that need to
 * branch on identity.
 *
 * @example
 * jseeqret whoami
 */
export const whoami_command = new Command('whoami')
    .description('Display the current user and their role')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()
        const self = await fetch_self(storage)

        if (self && admin && admin.username === self.username) {
            console.log(`${self.username} (owner)`)
        } else if (self) {
            console.log(self.username)
        } else {
            console.log(
                `${qualified_user()} (not a registered user of this vault)`
            )
        }
    })
