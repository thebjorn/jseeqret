import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import {
    registry_add, registry_remove, registry_use,
    registry_list, registry_resolve,
} from '../../core/vault-registry.js'
import { as_table } from '../utils.js'

const vault_commands = new Command('vault')
    .description('Manage vault registry')

vault_commands
    .command('list')
    .description('List registered vaults')
    .action(() => {
        const vaults = registry_list()
        if (vaults.length === 0) {
            console.log('No vaults registered.')
            console.log('Use `jseeqret vault add <name> <path>` to register one.')
            return
        }
        const rows = vaults.map(v => [
            v.is_default ? '* ' + v.name : '  ' + v.name,
            v.path,
            fs.existsSync(path.join(v.path, 'seeqrets.db')) ? 'yes' : 'no',
        ])
        as_table('Name, Path, Initialized', rows)
    })

vault_commands
    .command('add')
    .description('Register a vault path under a name')
    .argument('<name>', 'Vault name')
    .argument('<path>', 'Absolute path to vault directory')
    .action((name, vault_path) => {
        const abs_path = path.resolve(vault_path)
        if (!fs.existsSync(abs_path)) {
            console.error(`Warning: Directory ${abs_path} does not exist yet.`)
        }
        registry_add(name, abs_path)
        console.log(`Registered vault "${name}" → ${abs_path}`)
    })

vault_commands
    .command('remove')
    .description('Unregister a vault (does not delete files)')
    .argument('<name>', 'Vault name to remove')
    .action((name) => {
        const vault_path = registry_resolve(name)
        if (!registry_remove(name)) {
            console.error(`Error: Vault "${name}" is not registered.`)
            process.exit(1)
        }
        console.log(`Unregistered vault "${name}" (${vault_path})`)
    })

vault_commands
    .command('use')
    .description('Set the default vault')
    .argument('<name>', 'Vault name to use as default')
    .action((name) => {
        try {
            registry_use(name)
            console.log(`Default vault set to "${name}"`)
        } catch (e) {
            console.error(`Error: ${e.message}`)
            process.exit(1)
        }
    })

export { vault_commands }
