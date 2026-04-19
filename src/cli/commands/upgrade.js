import { Command } from 'commander'
import { get_seeqret_dir } from '../../core/vault.js'
import { upgrade_db } from '../../core/migrations.js'
import { require_vault } from '../utils.js'

/**
 * Run pending schema migrations against the current vault database.
 * Safe to run repeatedly; a no-op when the schema is already current.
 *
 * @example
 * jseeqret upgrade
 */
export const upgrade_command = new Command('upgrade')
    .description('Upgrade the database to the latest version')
    .action(async () => {
        require_vault()
        await upgrade_db(get_seeqret_dir())
    })
