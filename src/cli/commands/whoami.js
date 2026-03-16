import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { current_user } from '../../core/vault.js'
import { require_vault } from '../utils.js'

export const whoami_command = new Command('whoami')
    .description('Display the current user and their role')
    .action(async () => {
        require_vault()
        const user = current_user()
        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()

        if (admin && admin.username === user) {
            console.log(`${user} (owner)`)
        } else {
            const users = await storage.fetch_users({ username: user })
            if (users.length > 0) {
                console.log(user)
            } else {
                console.log(`${user} (not a registered user of this vault)`)
            }
        }
    })
