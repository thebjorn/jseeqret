import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { Secret } from '../../core/models/secret.js'
import { pull_secret } from '../../core/remote-ssh.js'
import { require_vault, fetch_remotes_or_exit } from '../utils.js'

/**
 * Fetch secrets from an ssh remote (using its get command) into the
 * vault. Values are stored directly and never printed -- use
 * `jseeqret get` afterwards if you need one.
 *
 * @example
 * jseeqret pull myhost SENDGRID_API_KEY
 *
 * @example
 * jseeqret pull myhost KEY1 KEY2 --app myapp --env prod --force
 */
export const pull_command = new Command('pull')
    .description('Pull secrets from an ssh remote into the vault')
    .argument('<alias>', 'Remote to pull from (see `jseeqret remote`)')
    .argument('<keys...>', 'Keys to fetch')
    .option('--app <app>', 'The app to store the secret(s) under', '*')
    .option('--env <env>', 'The env(ironment) to store the secret(s) under', '*')
    .option('--force', 'Overwrite secrets that already exist in the vault', false)
    .action(async (alias, keys, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        const remotes = await fetch_remotes_or_exit(storage, alias)
        if (remotes.length !== 1) {
            console.error('Error: pull takes a single remote.')
            process.exit(1)
        }
        const [remote] = remotes
        if (!remote.get_cmd) {
            console.error(
                `Error: Remote '${remote.alias}' has no get command, so`
                + ' nothing can be pulled from it.'
                + ' Re-add it with a --get template.'
            )
            process.exit(1)
        }
        if ([opts.app, opts.env, ...keys].some(s => s.includes(':'))) {
            console.error('Error: Colon `:` is not valid in key, app, or env')
            process.exit(1)
        }

        if (!opts.force) {
            const existing = []
            for (const key of keys) {
                const found = await storage.fetch_secrets({
                    app: opts.app, env: opts.env, key,
                })
                if (found.length > 0) existing.push(key)
            }
            if (existing.length > 0) {
                console.error(
                    `Error: Already in vault (${opts.app}:${opts.env}):`
                    + ` ${existing.join(', ')}. Use --force to overwrite.`
                )
                process.exit(1)
            }
        }

        let pulled = 0
        let failed = 0
        for (const key of keys) {
            const res = pull_secret(remote, key)
            if (!res.ok) {
                console.log(`  FAILED ${key}: ${res.error}`)
                failed += 1
                continue
            }
            await storage.upsert_secret(new Secret({
                app: opts.app, env: opts.env, key,
                plaintext_value: res.value, type: 'str',
            }))
            console.log(`  pulled ${key} -> ${opts.app}:${opts.env}`)
            pulled += 1
        }

        if (failed) {
            console.log(`Pulled ${pulled}, failed ${failed}.`)
            process.exit(1)
        }
        console.log(`Pulled ${pulled} secret(s) from ${remote.alias}.`)
    })
