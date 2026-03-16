import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault, as_table } from '../utils.js'

const edit_value = new Command('value')
    .description('Update secrets matching FILTER to the new VALUE')
    .argument('<filter>', 'Filter spec (app:env:key)')
    .argument('<value>', 'New value')
    .option('--all', 'Update all matching secrets without prompting')
    .action(async (filter, value, opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length === 0) {
            console.error(`Error: No secrets found for ${filter}`)
            process.exit(1)
        }

        if (secrets.length > 1 && !opts.all) {
            as_table('App, Env, Key, Value, Type', secrets)
            console.error('Multiple secrets match. Use --all to update all.')
            process.exit(1)
        }

        for (const secret of secrets) {
            secret.set_value(value)
            await storage.update_secret(secret)
        }

        console.log(`Updated ${secrets.length} secret(s).`)
        as_table('App, Env, Key, Value, Type', secrets)
    })

export const edit_commands = new Command('edit')
    .description('Edit a secret in the vault')

edit_commands.addCommand(edit_value)
