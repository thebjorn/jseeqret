import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { Secret } from '../../core/models/secret.js'
import { User } from '../../core/models/user.js'
import { requireVault } from '../utils.js'

const addKey = new Command('key')
  .description('Add a new secret to the vault')
  .argument('<name>', 'Secret name (key)')
  .argument('<value>', 'Secret value')
  .option('--app <app>', 'Application name', '*')
  .option('--env <env>', 'Environment name', '*')
  .option('--type <type>', 'Value type (str, int)', 'str')
  .action(async (name, value, opts) => {
    requireVault()
    const storage = new SqliteStorage()
    const secret = new Secret({
      app: opts.app,
      env: opts.env,
      key: name,
      plaintextValue: value,
      type: opts.type,
    })
    await storage.addSecret(secret)
    console.log(`Added secret: ${opts.app}:${opts.env}:${name}`)
  })

const addUser = new Command('user')
  .description('Add a new user to the vault')
  .requiredOption('--username <username>', 'Username')
  .requiredOption('--email <email>', 'User email')
  .requiredOption('--pubkey <pubkey>', 'User public key (base64)')
  .action(async (opts) => {
    requireVault()
    const storage = new SqliteStorage()
    const user = new User(opts.username, opts.email, opts.pubkey)
    await storage.addUser(user)
    console.log(`Added user: ${opts.username}`)
  })

export const addCommands = new Command('add')
  .description('Add a new secret or user')

addCommands.addCommand(addKey)
addCommands.addCommand(addUser)
