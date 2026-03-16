import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { requireVault, asTable } from '../utils.js'

export const usersCommand = new Command('users')
  .description('List the users in the vault')
  .option('--export', 'Export users as add commands')
  .action(async (opts) => {
    requireVault()
    const storage = new SqliteStorage()
    const users = await storage.fetchUsers()
    if (opts.export) {
      for (const user of users) {
        console.log(`jseeqret add user --username ${user.username} --email ${user.email} --pubkey ${user.pubkey}`)
      }
    } else {
      asTable('Username, Email, PublicKey', users)
    }
  })
