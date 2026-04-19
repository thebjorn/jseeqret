/**
 * Crypto barrel — Fernet (AES-128-CBC + HMAC-SHA256) for secrets at
 * rest, NaCl (X25519 + XSalsa20-Poly1305) for transit, plus key
 * loading helpers. Deliberately kept dependency-light: tweetnacl +
 * Node crypto only.
 *
 * @module core/crypto
 */

export * from './fernet.js'
export { asymmetric_encrypt, asymmetric_decrypt, hash_message, fingerprint, generate_key_pair, decode_key, encode_key, get_public_key } from './nacl.js'
export { load_symmetric_key, generate_symmetric_key, get_or_create_symmetric_key, generate_and_save_key_pair, load_private_key_str, load_public_key_str } from './utils.js'
