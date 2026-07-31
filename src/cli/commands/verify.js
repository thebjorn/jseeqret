import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { verify_secret } from '../../core/remote-ssh.js'
import { require_vault, fetch_filtered_secrets_or_exit } from '../utils.js'

/**
 * Verify that vault secrets match what an ssh remote actually has:
 * runs the remote's get command per matching secret and compares its
 * output to the vault value. Only key names and ok/MISSING/MISMATCH
 * are printed -- never the values themselves.
 *
 * @example
 * jseeqret verify myhost myapp:prod:*
 */
export const verify_command = new Command('verify')
    .description('Verify vault secrets against an ssh remote')
    .argument('<alias>', 'Remote to verify against (see `jseeqret remote`)')
    .argument('[filterspec]', 'Filter spec (app:env:key)', '')
    .option('-f, --filter <filter>', 'Filter spec (app:env:key)', '')
    .action(async (alias, filterspec, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        const remote = await storage.fetch_remote(alias)
        if (!remote) {
            console.error(
                `Error: No remote named ${alias}`
                + ' (register it with `jseeqret remote add`).'
            )
            process.exit(1)
        }
        if (!remote.get_cmd) {
            console.error(
                `Error: Remote '${remote.alias}' has no get command,`
                + ' so it cannot be verified.'
                + ' Re-add it with a --get template.'
            )
            process.exit(1)
        }

        const secrets = await fetch_filtered_secrets_or_exit(
            storage, filterspec, opts.filter
        )

        console.log(
            `Verifying ${secrets.length} secret(s) against`
            + ` ${remote.alias} (${remote.userhost})...`
        )

        let ok = 0
        let failed = 0
        for (const secret of secrets) {
            const status = verify_secret(remote, secret)
            if (status === 'ok') {
                console.log(`  ok       ${secret.key}`)
                ok += 1
            } else if (status === 'missing') {
                console.log(`  MISSING  ${secret.key}`)
                failed += 1
            } else {
                console.log(`  MISMATCH ${secret.key}`)
                failed += 1
            }
        }

        console.log('')
        if (failed) {
            console.log(`Verified ${ok}, failed ${failed}.`)
            process.exit(1)
        }
        console.log(
            `Verified ${ok} secret(s) against ${remote.alias}.`
        )
    })
