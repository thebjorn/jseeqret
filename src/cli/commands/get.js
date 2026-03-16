import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault } from '../utils.js'

export const get_command = new Command('get')
    .description('Get the value of a secret')
    .argument('<filter>', 'Filter spec (app:env:key)')
    .action(async (filter) => {
        require_vault()
        const storage = new SqliteStorage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length > 1) {
            console.error(`Error: Found ${secrets.length} secrets for ${filter}`)
            process.exit(1)
        }

        if (secrets.length === 0) {
            console.error(`Error: No secrets found for ${filter}`)
            process.exit(1)
        }

        console.log(secrets[0].get_value())
    })
