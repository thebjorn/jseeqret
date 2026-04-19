import { Command } from 'commander'
import { load_private_key_str, load_public_key_str } from '../../core/crypto/utils.js'
import { get_seeqret_dir } from '../../core/vault.js'
import { require_vault, as_table } from '../utils.js'

/**
 * Show the admin user's private and public keys from the vault
 * directory. Requires the vault to be initialized; values are the
 * base64-encoded plaintext read from `private.key` / `public.key`.
 *
 * @example
 * jseeqret keys
 */
export const keys_command = new Command('keys')
    .description("Show the admin's keys")
    .action(() => {
        require_vault()
        const vault_dir = get_seeqret_dir()
        const private_key = load_private_key_str(vault_dir)
        const public_key = load_public_key_str(vault_dir)
        as_table('PrivateKey, PublicKey', [[private_key, public_key]])
    })
