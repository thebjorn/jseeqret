import { Command } from 'commander'
import { isInitialized, getSeeqretDir } from '../../core/vault.js'

export const infoCommand = new Command('info')
  .description('Show vault info')
  .action(() => {
    console.log('jseeqret v0.1.0')
    console.log()
    if (isInitialized()) {
      console.log(`Vault directory: ${getSeeqretDir()}`)
      console.log('Status: initialized')
    } else {
      console.log('Status: not initialized')
      console.log('Run `jseeqret init` to create a vault.')
    }
    console.log()
    console.log('Commands:')
    console.log('  init <dir>          Initialize a new vault')
    console.log('  add key <n> <v>     Add a secret')
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
  })
