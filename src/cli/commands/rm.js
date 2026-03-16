import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { requireVault, asTable } from '../utils.js'

const rmKey = new Command('key')
  .description('Remove secrets matching filter')
  .argument('<filter>', 'Filter spec (app:env:key)')
  .action(async (filter) => {
    requireVault()
    const storage = new SqliteStorage()
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length === 0) {
      console.log('No matching secrets found.')
      return
    }
    asTable('App, Env, Key, Value, Type', secrets)
    await storage.removeSecrets(fspec.toFilterDict())
    console.log(`Removed ${secrets.length} secret(s).`)
  })

export const rmCommands = new Command('rm')
  .description('Remove a secret from the vault')

rmCommands.addCommand(rmKey)
