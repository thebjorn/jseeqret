import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { render_cmd, push_secret } from '../../core/remote-ssh.js'
import { require_vault, fetch_filtered_secrets_or_exit } from '../utils.js'

/**
 * Push secrets from the vault to an ssh remote registered with
 * `jseeqret remote add`. The remote's set command runs on the host
 * over ssh once per matching secret.
 *
 * @example
 * jseeqret push myhost myapp:prod:*
 *
 * @example
 * jseeqret push myhost myapp:prod:* --dry-run
 */
export const push_command = new Command('push')
    .description('Push secrets from the vault to an ssh remote')
    .argument('<alias>', 'Remote to push to (see `jseeqret remote`)')
    .argument('[filterspec]', 'Filter spec (app:env:key)', '')
    .option('-f, --filter <filter>', 'Filter spec (app:env:key)', '')
    .option(
        '--dry-run',
        'Show what would be pushed without making changes.',
        false
    )
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

        const secrets = await fetch_filtered_secrets_or_exit(
            storage, filterspec, opts.filter
        )

        console.log(
            `Pushing ${secrets.length} secret(s) to`
            + ` ${remote.alias} (${remote.userhost})...`
        )

        if (opts.dryRun) {
            // Mask any command-line value: unlike the real invocation,
            // dry-run output must never contain the secret. In stdin
            // mode the command carries no value, so it prints as-is.
            for (const secret of secrets) {
                const cmd = render_cmd(remote.set_cmd, secret.key, '*****')
                const suffix = remote.value_via_stdin
                    ? '  (value on stdin)' : ''
                console.log(`  would push ${secret.key}`)
                console.log(`    ssh ${remote.userhost} "${cmd}"${suffix}`)
            }
            return
        }

        let pushed = 0
        let failed = 0
        for (const secret of secrets) {
            const res = push_secret(remote, secret)
            if (res.ok) {
                console.log(`  pushed ${secret.key}`)
                pushed += 1
            } else {
                console.log(`  FAILED ${secret.key}: ${res.error}`)
                failed += 1
            }
        }

        console.log('')
        if (failed) {
            console.log(`Pushed ${pushed}, failed ${failed}.`)
            process.exit(1)
        }
        console.log(`Pushed ${pushed} secret(s) to ${remote.alias}.`)
    })
