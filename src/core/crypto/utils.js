/**
 * Key loading/saving utilities.
 */

import fs from 'fs'
import path from 'path'
import { generateKey } from './fernet.js'
import { generateKeyPair, encodeKey } from './nacl.js'

/**
 * Load a Fernet symmetric key from file.
 * @param {string} vaultDir - vault directory path
 * @param {string} [fname='seeqret.key'] - key filename
 * @returns {string} base64url-encoded Fernet key
 */
export function loadSymmetricKey(vaultDir, fname = 'seeqret.key') {
  const keyPath = path.join(vaultDir, fname)
  return fs.readFileSync(keyPath, 'utf-8').trim()
}

/**
 * Generate and save a new Fernet symmetric key.
 * @param {string} vaultDir - vault directory path
 * @param {string} [fname='seeqret.key'] - key filename
 * @returns {string} the generated key
 */
export function generateSymmetricKey(vaultDir, fname = 'seeqret.key') {
  const key = generateKey()
  const keyPath = path.join(vaultDir, fname)
  fs.writeFileSync(keyPath, key, 'utf-8')
  return key
}

/**
 * Load or generate a Fernet symmetric key.
 * @param {string} vaultDir
 * @param {string} [fname='seeqret.key']
 * @returns {string}
 */
export function getOrCreateSymmetricKey(vaultDir, fname = 'seeqret.key') {
  try {
    return loadSymmetricKey(vaultDir, fname)
  } catch (e) {
    if (e.code === 'ENOENT') {
      return generateSymmetricKey(vaultDir, fname)
    }
    throw e
  }
}

/**
 * Generate and save NaCl keypair files.
 * @param {string} vaultDir - vault directory path
 * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
 */
export function generateAndSaveKeyPair(vaultDir) {
  const keyPair = generateKeyPair()
  fs.writeFileSync(
    path.join(vaultDir, 'private.key'),
    encodeKey(keyPair.secretKey),
    'utf-8'
  )
  fs.writeFileSync(
    path.join(vaultDir, 'public.key'),
    encodeKey(keyPair.publicKey),
    'utf-8'
  )
  return keyPair
}

/**
 * Load the NaCl private key from file.
 * @param {string} vaultDir
 * @returns {string} base64-encoded private key
 */
export function loadPrivateKeyStr(vaultDir) {
  return fs.readFileSync(path.join(vaultDir, 'private.key'), 'utf-8').trim()
}

/**
 * Load the NaCl public key from file.
 * @param {string} vaultDir
 * @returns {string} base64-encoded public key
 */
export function loadPublicKeyStr(vaultDir) {
  return fs.readFileSync(path.join(vaultDir, 'public.key'), 'utf-8').trim()
}
