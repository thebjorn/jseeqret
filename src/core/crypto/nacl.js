/**
 * NaCl-compatible asymmetric encryption using tweetnacl.
 *
 * Compatible with Python's PyNaCl:
 *   - X25519 key agreement + XSalsa20-Poly1305 authenticated encryption
 *   - Keys stored as standard base64-encoded 32-byte values
 *   - Box.encrypt prepends a 24-byte nonce
 */

import nacl from 'tweetnacl'
import pkg from 'tweetnacl-util'
const { decodeBase64, encodeBase64, decodeUTF8, encodeUTF8 } = pkg
import { createHash } from 'crypto'

/**
 * Generate a new X25519 keypair.
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generate_key_pair() {
    return nacl.box.keyPair()
}

/**
 * Convert a base64-encoded string to a Uint8Array key.
 * @param {string} b64 - base64-encoded key
 * @returns {Uint8Array}
 */
export function decode_key(b64) {
    return decodeBase64(b64.trim())
}

/**
 * Encode a Uint8Array key as base64.
 * @param {Uint8Array} key
 * @returns {string}
 */
export function encode_key(key) {
    return encodeBase64(key)
}

/**
 * Derive the public key from a private key.
 * @param {Uint8Array} privateKey - 32-byte private key
 * @returns {Uint8Array} 32-byte public key
 */
export function get_public_key(privateKey) {
    return nacl.box.keyPair.fromSecretKey(privateKey).publicKey
}

/**
 * Encrypt a string using NaCl Box (X25519 + XSalsa20-Poly1305).
 * Compatible with PyNaCl's Box(sender_private, recipient_public).encrypt(msg).
 *
 * @param {string} plaintext - UTF-8 string to encrypt
 * @param {Uint8Array} sender_private_key - sender's private key
 * @param {Uint8Array} recipient_public_key - recipient's public key
 * @returns {string} base64-encoded encrypted message (nonce + ciphertext)
 */
export function asymmetric_encrypt(plaintext, sender_private_key, recipient_public_key) {
    const msg_bytes = decodeUTF8(plaintext)
    const nonce = nacl.randomBytes(nacl.box.nonceLength)
    const encrypted = nacl.box(msg_bytes, nonce, recipient_public_key, sender_private_key)

    // PyNaCl's Box.encrypt returns nonce + ciphertext concatenated
    const full_message = new Uint8Array(nonce.length + encrypted.length)
    full_message.set(nonce)
    full_message.set(encrypted, nonce.length)

    return encodeBase64(full_message)
}

/**
 * Decrypt a NaCl Box message.
 * Compatible with PyNaCl's Box(receiver_private, sender_public).decrypt(msg).
 *
 * @param {string} cipher_b64 - base64-encoded encrypted message (nonce + ciphertext)
 * @param {Uint8Array} receiver_private_key - receiver's private key
 * @param {Uint8Array} sender_public_key - sender's public key
 * @returns {string} decrypted UTF-8 string
 */
export function asymmetric_decrypt(cipher_b64, receiver_private_key, sender_public_key) {
    const full_message = decodeBase64(cipher_b64)
    const nonce = full_message.subarray(0, nacl.box.nonceLength)
    const ciphertext = full_message.subarray(nacl.box.nonceLength)

    const decrypted = nacl.box.open(ciphertext, nonce, sender_public_key, receiver_private_key)
    if (!decrypted) {
        throw new Error('NaCl decryption failed: invalid ciphertext or wrong keys')
    }

    return encodeUTF8(decrypted)
}

/**
 * SHA-256 hash of a message, returned as hex string.
 * Compatible with PyNaCl's nacl.hash.sha256 with HexEncoder.
 *
 * @param {Buffer|Uint8Array|string} data
 * @returns {string} hex-encoded SHA-256 hash
 */
export function hash_message(data) {
    return createHash('sha256').update(data).digest('hex')
}

/**
 * Short fingerprint: last 5 hex chars of SHA-256 hash.
 * @param {Buffer|Uint8Array|string} data
 * @returns {string}
 */
export function fingerprint(data) {
    const hash = hash_message(data)
    return hash.slice(-5)
}
