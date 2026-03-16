import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { requireVault } from '../utils.js'

export const getCommand = new Command('get')
  .description('Get the value of a secret')
  .argument('<filter>', 'Filter spec (app:env:key)')
  .action(async (filter) => {
    requireVault()
    const storage = new SqliteStorage()
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length > 1) {
      console.error(`Error: Found ${secrets.length} secrets for ${filter}`)
      process.exit(1)
    }
    if (secrets.length === 0) {
      console.error(`Error: No secrets found for ${filter}`)
      process.exit(1)
    }
    console.log(secrets[0].getValue())
  })
