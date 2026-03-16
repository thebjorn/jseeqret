import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault, as_table } from '../utils.js'

export const list_command = new Command('list')
    .description('List the contents of the vault')
    .option('-f, --filter <filter>', 'Filter spec (app:env:key)', '*')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const fspec = new FilterSpec(opts.filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length === 0) {
            console.log('No matching secrets found.')
            return
        }

        as_table('App, Env, Key, Value, Type', secrets)
    })
