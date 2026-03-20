import { Command } from 'commander'
import { createRequire } from 'module'
import { is_initialized, get_seeqret_dir } from '../../core/vault.js'
import { SqliteStorage } from '../../core/sqlite-storage.js'

const require = createRequire(import.meta.url)
const { version: pkg_version } = require('../../../package.json')

export const info_command = new Command('info')
    .description('Show vault info')
    .option('-d, --dump', 'Dump vault info as JSON')
    .action(async (opts) => {
        const initialized = is_initialized()
        const info = {
            version: pkg_version,
            initialized,
            vault_dir: null,
            owner: null,
            user_count: null,
            secret_count: null,
        }

        if (initialized) {
            info.vault_dir = get_seeqret_dir()
            try {
                const storage = new SqliteStorage()
                const admin = await storage.fetch_admin()
                if (admin) info.owner = admin.username
                const users = await storage.fetch_users()
                info.user_count = users.length
                const secrets = await storage.fetch_secrets({
                    app: '*', env: '*', key: '*',
                })
                info.secret_count = secrets.length
            } catch {
                // storage might fail if db is corrupted
            }
        }

        if (opts.dump) {
            console.log(JSON.stringify(info, null, 4))
            return
        }

        console.log(`jseeqret v${pkg_version}`)
        console.log()

        if (initialized) {
            console.log(`Vault directory: ${info.vault_dir}`)
            console.log('Status: initialized')
            if (info.owner) {
                console.log(`Owner: ${info.owner}`)
            }
            if (info.user_count !== null) {
                console.log(`Users: ${info.user_count}`)
            }
            if (info.secret_count !== null) {
                console.log(`Secrets: ${info.secret_count}`)
            }
        } else {
            console.log('Status: not initialized')
            console.log(
                'Run `jseeqret init` to create a vault.'
            )
        }

        console.log()
        console.log('Commands:')
        console.log('  init <dir>          Initialize a new vault')
        console.log('  add key <n> <v>     Add a secret')
        console.log('  add text <n>        Add a multi-line secret')
        console.log('  add user            Add a user')
        console.log('  list [-f filter]    List secrets')
        console.log('  get <filter>        Get a secret value')
        console.log('  edit value <f> <v>  Update a secret')
        console.log('  rm key <filter>     Remove secrets')
        console.log('  users               List users')
        console.log('  owner               Show vault owner')
        console.log('  whoami              Show current user role')
        console.log('  keys                Show admin keys')
        console.log('  upgrade             Upgrade database schema')
        console.log('  backup              Backup vault to JSON')
        console.log('  export --to <user>  Export secrets for a user')
        console.log('  load -f <file>      Import exported secrets')
        console.log('  env                 Generate .env from template')
        console.log('  importenv <file>    Import .env file')
        console.log('  setenv <filter>     Set Windows env variables')
        console.log('  serializers         List serializers')
        console.log('  server init         Initialize server vault')
        console.log('  introduction        Print onboarding info')
    })
