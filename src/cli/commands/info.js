import { Command } from 'commander'
import { is_initialized, get_seeqret_dir } from '../../core/vault.js'

export const info_command = new Command('info')
    .description('Show vault info')
    .action(() => {
        console.log('jseeqret v0.1.0')
        console.log()

        if (is_initialized()) {
            console.log(`Vault directory: ${get_seeqret_dir()}`)
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
        console.log('  backup              Backup vault to JSON')
        console.log('  export --to <user>  Export secrets for a user')
        console.log('  load -f <file>      Import exported secrets')
        console.log('  env                 Generate .env from template')
        console.log('  importenv <file>    Import .env file')
        console.log('  setenv <filter>     Set Windows env variables')
        console.log('  serializers         List serializers')
        console.log('  introduction        Print onboarding info')
    })
