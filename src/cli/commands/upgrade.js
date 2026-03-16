import { Command } from 'commander'
import { get_seeqret_dir } from '../../core/vault.js'
import { upgrade_db } from '../../core/migrations.js'
import { require_vault } from '../utils.js'

export const upgrade_command = new Command('upgrade')
    .description('Upgrade the database to the latest version')
    .action(async () => {
        require_vault()
        await upgrade_db(get_seeqret_dir())
    })
