import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { requireVault, asTable } from '../utils.js'

const editValue = new Command('value')
  .description('Update secrets matching FILTER to the new VALUE')
  .argument('<filter>', 'Filter spec (app:env:key)')
  .argument('<value>', 'New value')
  .option('--all', 'Update all matching secrets without prompting')
  .action(async (filter, value, opts) => {
    requireVault()
    const storage = new SqliteStorage()
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length === 0) {
      console.error(`Error: No secrets found for ${filter}`)
      process.exit(1)
    }
    if (secrets.length > 1 && !opts.all) {
      asTable('App, Env, Key, Value, Type', secrets)
      console.error('Multiple secrets match. Use --all to update all.')
      process.exit(1)
    }
    for (const secret of secrets) {
      secret.setValue(value)
      await storage.updateSecret(secret)
    }
    console.log(`Updated ${secrets.length} secret(s).`)
    asTable('App, Env, Key, Value, Type', secrets)
  })

export const editCommands = new Command('edit')
  .description('Edit a secret in the vault')

editCommands.addCommand(editValue)
