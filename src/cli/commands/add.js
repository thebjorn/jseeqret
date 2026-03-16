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
    .action(async (name, value, opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const secret = new Secret({
            app: opts.app,
            env: opts.env,
            key: name,
            plaintext_value: value,
            type: opts.type,
        })
        await storage.add_secret(secret)
        console.log(`Added secret: ${opts.app}:${opts.env}:${name}`)
    })

const add_user = new Command('user')
    .description('Add a new user to the vault')
    .requiredOption('--username <username>', 'Username')
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--pubkey <pubkey>', 'User public key (base64)')
    .action(async (opts) => {
        require_vault()
        const storage = new SqliteStorage()
        const user = new User(opts.username, opts.email, opts.pubkey)
        await storage.add_user(user)
        console.log(`Added user: ${opts.username}`)
    })

export const add_commands = new Command('add')
    .description('Add a new secret or user')

add_commands.addCommand(add_key)
add_commands.addCommand(add_user)
