/**
 * Secret model - compatible with Python seeqret's Secret class.
 *
 * Values are Fernet-encrypted at rest in the database.
 */

import { encrypt, decrypt } from '../crypto/fernet.js'
import { loadSymmetricKey } from '../crypto/utils.js'
import { asymmetricEncrypt, asymmetricDecrypt, fingerprint as naclFingerprint } from '../crypto/nacl.js'
import { getSeeqretDir } from '../vault.js'

function cnvt(typename, val) {
  if (typename === 'int') return parseInt(val, 10)
  return val
}

export class Secret {
  /**
   * @param {object} opts
   * @param {string} opts.app
   * @param {string} opts.env
   * @param {string} opts.key
   * @param {Buffer|string} [opts.value] - encrypted Fernet token
   * @param {string} [opts.type='str']
   * @param {string} [opts.plaintextValue] - if provided, will be encrypted
   * @param {string} [opts.vaultDir] - vault directory (defaults to getSeeqretDir())
   */
  constructor({ app, env, key, value = null, type = 'str', plaintextValue = null, vaultDir = null }) {
    if (!value && !plaintextValue) {
      throw new Error('value or plaintextValue is required')
    }
    this.app = app
    this.env = env
    this.key = key
    this.type = type
    this._vaultDir = vaultDir
    this._value = value  // encrypted bytes

    if (plaintextValue != null) {
      this.setValue(plaintextValue)
    }
  }

  get vaultDir() {
    return this._vaultDir || getSeeqretDir()
  }

  /**
   * Get the decrypted plaintext value.
   * @returns {string|number}
   */
  getValue() {
    const keyStr = loadSymmetricKey(this.vaultDir)
    const val = decrypt(keyStr, this._value).toString('utf-8')
    return cnvt(this.type, val)
  }

  /**
   * Set value by encrypting plaintext.
   * @param {string} plaintext
   */
  setValue(plaintext) {
    const keyStr = loadSymmetricKey(this.vaultDir)
    this._value = encrypt(keyStr, Buffer.from(String(plaintext), 'utf-8'))
  }

  /**
   * Get the raw encrypted value (for database storage).
   * @returns {Buffer|string}
   */
  get encryptedValue() {
    return this._value
  }

  /**
   * Encrypt the plaintext value for transfer using NaCl Box.
   * @param {Uint8Array} senderPrivateKey
   * @param {Uint8Array} recipientPublicKey
   * @returns {string} base64-encoded encrypted value
   */
  encryptValue(senderPrivateKey, recipientPublicKey) {
    return asymmetricEncrypt(
      String(this.getValue()),
      senderPrivateKey,
      recipientPublicKey
    )
  }

  /**
   * Decrypt a value received via transfer.
   * @param {string} cipher - base64-encoded encrypted value
   * @param {Uint8Array} senderPublicKey
   * @param {Uint8Array} receiverPrivateKey
   * @returns {string}
   */
  static decryptValue(cipher, senderPublicKey, receiverPrivateKey) {
    return asymmetricDecrypt(cipher, receiverPrivateKey, senderPublicKey)
  }

  /**
   * Get a short fingerprint of this secret.
   * @returns {string}
   */
  fingerprint() {
    const txt = `${this.app}:${this.env}:${this.key}:${this.type}:${this.getValue()}`
    return naclFingerprint(Buffer.from(txt, 'utf-8'))
  }

  /**
   * Encrypt to a dict for JSON export.
   * @param {Uint8Array} senderPrivateKey
   * @param {Uint8Array} recipientPublicKey
   * @returns {object}
   */
  encryptToDict(senderPrivateKey, recipientPublicKey) {
    return {
      app: this.app,
      env: this.env,
      key: this.key,
      value: this.encryptValue(senderPrivateKey, recipientPublicKey),
      type: this.type,
    }
  }

  toPlaintextDict() {
    return {
      app: this.app,
      env: this.env,
      key: this.key,
      type: this.type,
      value: this.getValue(),
    }
  }

  toJSON() {
    return {
      app: this.app,
      env: this.env,
      key: this.key,
      value: this._value,
      type: this.type,
    }
  }

  get row() {
    return [this.app, this.env, this.key, this.getValue(), this.type]
  }

  toString() {
    return `Secret(${this.app}, ${this.env}, ${this.key}, ${this.getValue()}, ${this.type})`
  }
}
