/**
 * Key loading/saving utilities.
 */

import fs from 'fs'
import path from 'path'
import { generate_key } from './fernet.js'
import { generate_key_pair, encode_key } from './nacl.js'

/**
 * Load a Fernet symmetric key from file.
 * @param {string} vault_dir - vault directory path
 * @param {string} [fname='seeqret.key'] - key filename
 * @returns {string} base64url-encoded Fernet key
 */
export function load_symmetric_key(vault_dir, fname = 'seeqret.key') {
    const key_path = path.join(vault_dir, fname)
    return fs.readFileSync(key_path, 'utf-8').trim()
}

/**
 * Generate and save a new Fernet symmetric key.
 * @param {string} vault_dir - vault directory path
 * @param {string} [fname='seeqret.key'] - key filename
 * @returns {string} the generated key
 */
export function generate_symmetric_key(vault_dir, fname = 'seeqret.key') {
    const key = generate_key()
    const key_path = path.join(vault_dir, fname)
    fs.writeFileSync(key_path, key, 'utf-8')
    return key
}

/**
 * Load or generate a Fernet symmetric key.
 * @param {string} vault_dir
 * @param {string} [fname='seeqret.key']
 * @returns {string}
 */
export function get_or_create_symmetric_key(vault_dir, fname = 'seeqret.key') {
    try {
        return load_symmetric_key(vault_dir, fname)
    } catch (e) {
        if (e.code === 'ENOENT') {
            return generate_symmetric_key(vault_dir, fname)
        }
        throw e
    }
}

/**
 * Generate and save NaCl keypair files.
 * @param {string} vault_dir - vault directory path
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generate_and_save_key_pair(vault_dir) {
    const key_pair = generate_key_pair()

    fs.writeFileSync(
        path.join(vault_dir, 'private.key'),
        encode_key(key_pair.secretKey),
        'utf-8'
    )
    fs.writeFileSync(
        path.join(vault_dir, 'public.key'),
        encode_key(key_pair.publicKey),
        'utf-8'
    )

    return key_pair
}

/**
 * Load the NaCl private key from file.
 * @param {string} vault_dir
 * @returns {string} base64-encoded private key
 */
export function load_private_key_str(vault_dir) {
    return fs.readFileSync(path.join(vault_dir, 'private.key'), 'utf-8').trim()
}

/**
 * Load the NaCl public key from file.
 * @param {string} vault_dir
 * @returns {string} base64-encoded public key
 */
export function load_public_key_str(vault_dir) {
    return fs.readFileSync(path.join(vault_dir, 'public.key'), 'utf-8').trim()
}
