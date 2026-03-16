import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { runMigrations } from '../../core/migrations.js'
import { generateSymmetricKey, generateAndSaveKeyPair } from '../../core/crypto/utils.js'
import { encodeKey } from '../../core/crypto/nacl.js'

export const initCommand = new Command('init')
  .description('Initialize a new vault in DIR')
  .argument('[dir]', 'Directory to initialize vault in', '.')
  .requiredOption('--user <username>', 'Vault owner username')
  .requiredOption('--email <email>', 'Vault owner email')
  .option('--pubkey <pubkey>', 'Existing public key (base64)')
  .option('--key <key>', 'Existing symmetric key')
  .action(async (dir, opts) => {
    const dirname = path.resolve(dir)
    const vaultDir = path.join(dirname, 'seeqret')

    if (!fs.existsSync(dirname)) {
      console.error(`Error: Parent directory ${dirname} must exist.`)
      process.exit(1)
    }

    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true })
    }

    // Generate or use provided symmetric key
    if (opts.key) {
      fs.writeFileSync(path.join(vaultDir, 'seeqret.key'), opts.key, 'utf-8')
    } else {
      generateSymmetricKey(vaultDir)
    }

    // Generate or use provided keypair
    let pubkey
    if (opts.pubkey) {
      pubkey = opts.pubkey
      fs.writeFileSync(path.join(vaultDir, 'public.key'), pubkey, 'utf-8')
    } else {
      const keyPair = generateAndSaveKeyPair(vaultDir)
      pubkey = encodeKey(keyPair.publicKey)
    }

    // Initialize database
    await runMigrations(vaultDir, opts.user, opts.email, pubkey)

    console.log(`Vault initialized in ${vaultDir}`)
    console.log(`\nSet the JSEEQRET environment variable:`)
    if (process.platform === 'win32') {
      console.log(`  setx JSEEQRET "${vaultDir}"`)
      console.log(`  set "JSEEQRET=${vaultDir}"`)
    } else {
      console.log(`  export JSEEQRET="${vaultDir}"`)
    }
  })
