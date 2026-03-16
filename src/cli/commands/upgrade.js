import { Command } from 'commander'
import { getSeeqretDir } from '../../core/vault.js'
import { upgradeDb } from '../../core/migrations.js'
import { requireVault } from '../utils.js'

export const upgradeCommand = new Command('upgrade')
  .description('Upgrade the database to the latest version')
  .action(async () => {
    requireVault()
    await upgradeDb(getSeeqretDir())
  })
