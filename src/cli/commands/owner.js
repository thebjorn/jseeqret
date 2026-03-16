import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { require_vault, as_table } from '../utils.js'

export const owner_command = new Command('owner')
    .description('Show the owner of the vault')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()

        if (!admin) {
            console.error('Error: No admin found.')
            process.exit(1)
        }

        as_table('Username, Email, PublicKey', [admin])
    })
