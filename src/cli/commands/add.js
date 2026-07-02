import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { Secret } from '../../core/models/secret.js'
import { User } from '../../core/models/user.js'
import { require_vault } from '../utils.js'

const add_key = new Command('key')
    .description('Add a new secret to the vault')
    .argument('<name>', 'Secret name (key)')
    .argument('<value>', 'Secret value')
    .option('--app <app>', 'Application name', '*')
    .option('--env <env>', 'Environment name', '*')
    .option('--type <type>', 'Value type (str, int)', 'str')
    .option('--force', 'Overwrite the value if the key already exists', false)
    .action(async (name, value, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        const existing = await storage.fetch_secrets({
            app: opts.app, env: opts.env, key: name,
        })

        const secret = new Secret({
            app: opts.app,
            env: opts.env,
            key: name,
            plaintext_value: value,
            type: opts.type,
        })

        if (existing.length > 0) {
            if (!opts.force) {
                console.error(
                    `Error: Secret ${opts.app}:${opts.env}:${name}`
                    + ' already exists.'
                )
                process.exit(1)
            }
            await storage.upsert_secret(secret)
            console.log(`Updated secret: ${opts.app}:${opts.env}:${name}`)
        } else {
            await storage.add_secret(secret)
            console.log(`Added secret: ${opts.app}:${opts.env}:${name}`)
        }
    })

/**
 * Read lines from stdin until EOF (Ctrl-D on Unix, Ctrl-Z on Windows).
 * @returns {Promise<string>}
 */
function read_stdin_until_eof() {
    return new Promise((resolve, reject) => {
        const chunks = []
        process.stdin.setEncoding('utf-8')
        process.stdin.on('data', chunk => chunks.push(chunk))
        process.stdin.on('end', () => resolve(chunks.join('')))
        process.stdin.on('error', reject)
        process.stdin.resume()
    })
}

const add_text = new Command('text')
    .description('Add a multi-line secret (reads stdin until EOF)')
    .argument('<name>', 'Secret name (key)')
    .option('--app <app>', 'Application name', '*')
    .option('--env <env>', 'Environment name', '*')
    .action(async (name, opts) => {
        require_vault()
        const storage = new SqliteStorage()

        // Check if secret already exists
        const existing = await storage.fetch_secrets({
            app: opts.app, env: opts.env, key: name,
        })
        if (existing.length > 0) {
            console.error(
                `Error: Secret ${opts.app}:${opts.env}:${name}`
                + ' already exists.'
            )
            process.exit(1)
        }

        if (process.stdin.isTTY) {
            console.error(
                'Enter secret value (Ctrl-D to finish):'
            )
        }

        const value = (await read_stdin_until_eof()).replace(
            /\r/g, ''
        )

        const secret = new Secret({
            app: opts.app,
            env: opts.env,
            key: name,
            plaintext_value: value,
            type: 'str',
        })
        await storage.add_secret(secret)
        console.log(`Added secret: ${opts.app}:${opts.env}:${name}`)
    })

const add_user = new Command('user')
    .description('Add a new user to the vault')
    .requiredOption('--username <username>', 'Username')
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--pubkey <pubkey>', 'User public key (base64)')
    .option('--name <name>', 'Display name (the person, not the account)')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const user = new User(opts.username, opts.email, opts.pubkey, {
            name: opts.name || null,
        })
        await storage.add_user(user)
        console.log(`Added user: ${opts.username}`)
    })

/**
 * Add a new secret (or multi-line secret via `add text`) or user to
 * the vault. Use `<app>:<env>:<key>` scoping with `--app` / `--env`;
 * values are encrypted with the vault's symmetric key before storage.
 *
 * @example
 * // Single-line secret
 * jseeqret add key DB_PASSWORD hunter2 --app myapp --env prod
 *
 * @example
 * // Multi-line secret from stdin
 * cat key.pem | jseeqret add text PRIVATE_KEY --app myapp
 */
export const add_commands = new Command('add')
    .description('Add a new secret or user')

add_commands.addCommand(add_key)
add_commands.addCommand(add_text)
add_commands.addCommand(add_user)
