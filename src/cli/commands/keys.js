import { Command } from 'commander'
import { loadPrivateKeyStr, loadPublicKeyStr } from '../../core/crypto/utils.js'
import { getSeeqretDir } from '../../core/vault.js'
import { requireVault, asTable } from '../utils.js'

export const keysCommand = new Command('keys')
  .description("Show the admin's keys")
  .action(() => {
    requireVault()
    const vaultDir = getSeeqretDir()
    const privateKey = loadPrivateKeyStr(vaultDir)
    const publicKey = loadPublicKeyStr(vaultDir)
    asTable('PrivateKey, PublicKey', [[privateKey, publicKey]])
  })
