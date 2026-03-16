/**
 * Fernet-compatible symmetric encryption.
 *
 * Implements the Fernet token spec used by Python's cryptography.fernet.Fernet:
 *   Token = Version (0x80) || Timestamp (8 bytes BE) || IV (16 bytes)
 *           || Ciphertext (AES-128-CBC, PKCS7) || HMAC-SHA256 (32 bytes)
 *   The token is then base64url-encoded.
 *
 * Key: 32 bytes, base64url-encoded (44 chars).
 *   First 16 bytes = HMAC-SHA256 signing key
 *   Last 16 bytes  = AES-128-CBC encryption key
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

/**
 * Decode a base64url string to a Buffer.
 */
function base64url_decode(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(b64, 'base64')
}

/**
 * Encode a Buffer as base64url.
 */
function base64url_encode(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Generate a new Fernet key (32 random bytes, base64url-encoded).
 * @returns {string} base64url-encoded key (44 chars)
 */
export function generate_key() {
    return base64url_encode(randomBytes(32))
}

/**
 * Encrypt plaintext bytes using a Fernet key.
 * @param {string} key_str - base64url-encoded Fernet key
 * @param {Buffer} plaintext - data to encrypt
 * @returns {string} Fernet token as base64url-encoded string
 */
export function encrypt(key_str, plaintext) {
    const key_bytes = base64url_decode(key_str)
    const signing_key = key_bytes.subarray(0, 16)
    const encryption_key = key_bytes.subarray(16, 32)

    const version = Buffer.from([0x80])

    // Timestamp: seconds since epoch, 8 bytes big-endian
    const now = Math.floor(Date.now() / 1000)
    const timestamp = Buffer.alloc(8)
    timestamp.writeBigUInt64BE(BigInt(now))

    const iv = randomBytes(16)

    // AES-128-CBC with PKCS7 padding (Node's default for CBC)
    const cipher = createCipheriv('aes-128-cbc', encryption_key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

    // HMAC-SHA256 over version + timestamp + iv + ciphertext
    const hmac_payload = Buffer.concat([version, timestamp, iv, ciphertext])
    const hmac = createHmac('sha256', signing_key).update(hmac_payload).digest()

    // Full token: version + timestamp + iv + ciphertext + hmac
    const token = Buffer.concat([version, timestamp, iv, ciphertext, hmac])

    // Fernet tokens are base64url-encoded strings
    return base64url_encode(token)
}

/**
 * Decrypt a Fernet token using a Fernet key.
 * @param {string} key_str - base64url-encoded Fernet key
 * @param {Buffer|string} token - Fernet token (base64url-encoded)
 * @returns {Buffer} decrypted plaintext
 */
export function decrypt(key_str, token) {
    const key_bytes = base64url_decode(key_str)
    const signing_key = key_bytes.subarray(0, 16)
    const encryption_key = key_bytes.subarray(16, 32)

    // Token might be a Buffer, Uint8Array, or string
    let token_str
    if (typeof token === 'string') {
        token_str = token
    } else if (token instanceof Uint8Array || Buffer.isBuffer(token)) {
        token_str = Buffer.from(token).toString('utf-8')
    } else {
        token_str = String(token)
    }
    const token_bytes = base64url_decode(token_str)

    // Parse token components
    const version = token_bytes[0]
    if (version !== 0x80) {
        throw new Error(`Invalid Fernet token version: ${version}`)
    }

    const timestamp = token_bytes.subarray(1, 9)
    const iv = token_bytes.subarray(9, 25)
    const hmac_value = token_bytes.subarray(token_bytes.length - 32)
    const ciphertext = token_bytes.subarray(25, token_bytes.length - 32)

    // Verify HMAC
    const hmac_payload = token_bytes.subarray(0, token_bytes.length - 32)
    const expected_hmac = createHmac('sha256', signing_key).update(hmac_payload).digest()
    if (!Buffer.from(hmac_value).equals(expected_hmac)) {
        throw new Error('Invalid Fernet token: HMAC verification failed')
    }

    // Decrypt AES-128-CBC
    const decipher = createDecipheriv('aes-128-cbc', encryption_key, iv)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
