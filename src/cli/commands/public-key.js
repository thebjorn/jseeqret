import { Command } from 'commander'
import { load_public_key_str } from '../../core/crypto/utils.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault, as_table } from '../utils.js'

/**
 * Show the admin user's public key from the vault directory. The public
 * key is safe to share -- it is the key other users encrypt secrets to
 * when sending them into this vault. The private key is intentionally
 * never printed; it must never leave the vault directory.
 *
 * @example
 * jseeqret public-key
 */
export const public_key_command = new Command('public-key')
    .description("Show the admin's public key")
    .action(() => {
        require_vault()
        const vault_dir = get_seeqret_dir()
        const public_key = load_public_key_str(vault_dir)
        as_table('PublicKey', [[public_key]])
    })
