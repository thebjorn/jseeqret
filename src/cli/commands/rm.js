import readline from 'readline'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault, as_table, resolve_user_or_exit } from '../utils.js'

/**
 * Prompt for a yes/no confirmation. Resolves true only on y / yes.
 */
function _confirm(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })
        rl.question(question, (answer) => {
            rl.close()
            resolve(/^y(es)?$/i.test(answer.trim()))
        })
    })
}

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

const rm_user = new Command('user')
    .description('Remove a user from the vault')
    .argument('<username>', 'User to remove (bare or user@host)')
    .option('--yes', 'Remove without prompting for confirmation', false)
    .action(async (username, opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const target = await resolve_user_or_exit(storage, username)

        const admin = await storage.fetch_admin()
        if (admin && admin.username === target.username) {
            console.error(
                `Error: cannot remove the vault owner: ${target.username}.`
            )
            process.exit(1)
        }

        as_table('Username, Email, PublicKey', [target])

        if (!opts.yes) {
            const ok = await _confirm(`Remove user ${target.username}? [y/N] `)
            if (!ok) {
                console.log('Aborting.')
                return
            }
        }

        await storage.remove_user(target.username)
        console.log(`Removed user ${target.username}.`)
    })

/**
 * Remove things from the vault. `rm key` removes every secret matching a
 * filter spec; `rm user` removes a user (but never the vault owner).
 * Destructive and not recoverable unless you have a prior `backup`.
 *
 * @example
 * jseeqret rm key myapp:dev:OLD_TOKEN
 *
 * @example
 * jseeqret rm user bob
 */
export const rm_commands = new Command('rm')
    .description('Remove a secret or user from the vault')

rm_commands.addCommand(rm_key)
rm_commands.addCommand(rm_user)
