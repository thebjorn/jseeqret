import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { current_user } from '../../core/vault.js'
import { require_vault } from '../utils.js'

export const introduction_command = new Command('introduction')
    .description('Print your public key for vault onboarding')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const username = current_user()
        const user = await storage.fetch_user(username)

        if (!user) {
            console.error(`Error: You (${username}) are not registered in this vault.`)
            console.error('Ask the vault owner to add you.')
            process.exit(1)
        }

        console.log('Please add me to your vault!\n')
        console.log(`jseeqret add user --username ${user.username} --email ${user.email} --pubkey ${user.pubkey}`)
    })
