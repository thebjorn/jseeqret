import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault, as_table } from '../utils.js'

const rm_key = new Command('key')
    .description('Remove secrets matching filter')
    .argument('<filter>', 'Filter spec (app:env:key)')
    .action(async (filter) => {
        require_vault()
        const storage = new SqliteStorage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length === 0) {
            console.log('No matching secrets found.')
            return
        }

        as_table('App, Env, Key, Value, Type', secrets)
        await storage.remove_secrets(fspec.to_filter_dict())
        console.log(`Removed ${secrets.length} secret(s).`)
    })

export const rm_commands = new Command('rm')
    .description('Remove a secret from the vault')

rm_commands.addCommand(rm_key)
