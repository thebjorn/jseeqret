import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { currentUser } from '../../core/vault.js'
import { requireVault } from '../utils.js'

export const whoamiCommand = new Command('whoami')
  .description('Display the current user and their role')
  .action(async () => {
    requireVault()
    const user = currentUser()
    const storage = new SqliteStorage()
    const admin = await storage.fetchAdmin()
    if (admin && admin.username === user) {
      console.log(`${user} (owner)`)
    } else {
      const users = await storage.fetchUsers({ username: user })
      if (users.length > 0) {
        console.log(user)
      } else {
        console.log(`${user} (not a registered user of this vault)`)
      }
    }
  })
