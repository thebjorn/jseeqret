import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { qualified_user } from '../../core/vault.js'
import { fetch_self } from '../../core/user-resolve.js'
import { require_vault } from '../utils.js'
import { compute_fingerprint } from '../../core/slack/identity.js'

/**
 * Print a ready-to-paste `jseeqret add user ...` line plus the public
 * key fingerprint so a vault admin can onboard you. The fingerprint
 * is meant to be read aloud on a voice call to verify identity.
 *
 * @example
 * jseeqret introduction | pbcopy
 */
export const introduction_command = new Command('introduction')
    .description('Print your public key and fingerprint for vault onboarding')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const user = await fetch_self(storage)

        if (!user) {
            console.error(`Error: You (${qualified_user()}) are not registered in this vault.`)
            console.error('Ask the vault owner to add you.')
            process.exit(1)
        }

        console.log('Please add me to your vault!\n')
        console.log(`jseeqret add user --username ${user.username} --email ${user.email} --pubkey ${user.pubkey}`)
        console.log(`\nPublic key fingerprint: ${compute_fingerprint(user)}`)
        console.log('(Read this aloud on a voice call to verify your identity.)')
    })
