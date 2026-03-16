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
function base64urlDecode(str) {
  // Fernet keys use URL-safe base64 with = padding
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

/**
 * Encode a Buffer as base64url.
 */
function base64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Generate a new Fernet key (32 random bytes, base64url-encoded).
 * @returns {string} base64url-encoded key (44 chars)
 */
export function generateKey() {
  return base64urlEncode(randomBytes(32))
}

/**
 * Encrypt plaintext bytes using a Fernet key.
 * @param {string} keyStr - base64url-encoded Fernet key
 * @param {Buffer} plaintext - data to encrypt
 * @returns {string} Fernet token as base64url-encoded string
 */
export function encrypt(keyStr, plaintext) {
  const keyBytes = base64urlDecode(keyStr)
  const signingKey = keyBytes.subarray(0, 16)
  const encryptionKey = keyBytes.subarray(16, 32)

  const version = Buffer.from([0x80])

  // Timestamp: seconds since epoch, 8 bytes big-endian
  const now = Math.floor(Date.now() / 1000)
  const timestamp = Buffer.alloc(8)
  timestamp.writeBigUInt64BE(BigInt(now))

  const iv = randomBytes(16)

  // AES-128-CBC with PKCS7 padding (Node's default for CBC)
  const cipher = createCipheriv('aes-128-cbc', encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

  // HMAC-SHA256 over version + timestamp + iv + ciphertext
  const hmacPayload = Buffer.concat([version, timestamp, iv, ciphertext])
  const hmac = createHmac('sha256', signingKey).update(hmacPayload).digest()

  // Full token: version + timestamp + iv + ciphertext + hmac
  const token = Buffer.concat([version, timestamp, iv, ciphertext, hmac])

  // Fernet tokens are base64url-encoded strings
  return base64urlEncode(token)
}

/**
 * Decrypt a Fernet token using a Fernet key.
 * @param {string} keyStr - base64url-encoded Fernet key
 * @param {Buffer|string} token - Fernet token (base64url-encoded)
 * @returns {Buffer} decrypted plaintext
 */
export function decrypt(keyStr, token) {
  const keyBytes = base64urlDecode(keyStr)
  const signingKey = keyBytes.subarray(0, 16)
  const encryptionKey = keyBytes.subarray(16, 32)

  // Token might be a Buffer, Uint8Array, or string
  let tokenStr
  if (typeof token === 'string') {
    tokenStr = token
  } else if (token instanceof Uint8Array || Buffer.isBuffer(token)) {
    tokenStr = Buffer.from(token).toString('utf-8')
  } else {
    tokenStr = String(token)
  }
  const tokenBytes = base64urlDecode(tokenStr)

  // Parse token components
  const version = tokenBytes[0]
  if (version !== 0x80) {
    throw new Error(`Invalid Fernet token version: ${version}`)
  }

  const timestamp = tokenBytes.subarray(1, 9)
  const iv = tokenBytes.subarray(9, 25)
  const hmacValue = tokenBytes.subarray(tokenBytes.length - 32)
  const ciphertext = tokenBytes.subarray(25, tokenBytes.length - 32)

  // Verify HMAC
  const hmacPayload = tokenBytes.subarray(0, tokenBytes.length - 32)
  const expectedHmac = createHmac('sha256', signingKey).update(hmacPayload).digest()
  if (!Buffer.from(hmacValue).equals(expectedHmac)) {
    throw new Error('Invalid Fernet token: HMAC verification failed')
  }

  // Decrypt AES-128-CBC
  const decipher = createDecipheriv('aes-128-cbc', encryptionKey, iv)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
