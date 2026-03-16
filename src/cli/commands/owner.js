import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { requireVault, asTable } from '../utils.js'

export const ownerCommand = new Command('owner')
  .description('Show the owner of the vault')
  .action(async () => {
    requireVault()
    const storage = new SqliteStorage()
    const admin = await storage.fetchAdmin()
    if (!admin) {
      console.error('Error: No admin found.')
      process.exit(1)
    }
    asTable('Username, Email, PublicKey', [admin])
  })
