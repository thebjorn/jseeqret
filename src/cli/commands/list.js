import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { requireVault, asTable } from '../utils.js'

export const listCommand = new Command('list')
  .description('List the contents of the vault')
  .option('-f, --filter <filter>', 'Filter spec (app:env:key)', '*')
  .action(async (opts) => {
    requireVault()
    const storage = new SqliteStorage()
    const fspec = new FilterSpec(opts.filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length === 0) {
      console.log('No matching secrets found.')
      return
    }
    asTable('App, Env, Key, Value, Type', secrets)
  })
