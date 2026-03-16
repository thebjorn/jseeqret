/**
 * Secret model - compatible with Python seeqret's Secret class.
 *
 * Values are Fernet-encrypted at rest in the database.
 */

import { encrypt, decrypt } from '../crypto/fernet.js'
import { load_symmetric_key } from '../crypto/utils.js'
import {
    asymmetric_encrypt,
    asymmetric_decrypt,
    fingerprint as nacl_fingerprint,
} from '../crypto/nacl.js'
import { get_seeqret_dir } from '../vault.js'

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
     * @param {string} [opts.plaintext_value] - if provided, will be encrypted
     * @param {string} [opts.vault_dir] - vault directory (defaults to get_seeqret_dir())
     */
    constructor({ app, env, key, value = null, type = 'str', plaintext_value = null, vault_dir = null }) {
        if (!value && !plaintext_value) {
            throw new Error('value or plaintext_value is required')
        }

        this.app = app
        this.env = env
        this.key = key
        this.type = type
        this._vault_dir = vault_dir
        this._value = value

        if (plaintext_value != null) {
            this.set_value(plaintext_value)
        }
    }

    get vault_dir() {
        return this._vault_dir || get_seeqret_dir()
    }

    /**
     * Get the decrypted plaintext value.
     * @returns {string|number}
     */
    get_value() {
        const key_str = load_symmetric_key(this.vault_dir)
        const val = decrypt(key_str, this._value).toString('utf-8')
        return cnvt(this.type, val)
    }

    /**
     * Set value by encrypting plaintext.
     * @param {string} plaintext
     */
    set_value(plaintext) {
        const key_str = load_symmetric_key(this.vault_dir)
        this._value = encrypt(key_str, Buffer.from(String(plaintext), 'utf-8'))
    }

    /**
     * Get the raw encrypted value (for database storage).
     * @returns {Buffer|string}
     */
    get encrypted_value() {
        return this._value
    }

    /**
     * Encrypt the plaintext value for transfer using NaCl Box.
     * @param {Uint8Array} sender_private_key
     * @param {Uint8Array} recipient_public_key
     * @returns {string} base64-encoded encrypted value
     */
    encrypt_value(sender_private_key, recipient_public_key) {
        return asymmetric_encrypt(
            String(this.get_value()),
            sender_private_key,
            recipient_public_key
        )
    }

    /**
     * Decrypt a value received via transfer.
     * @param {string} cipher - base64-encoded encrypted value
     * @param {Uint8Array} sender_public_key
     * @param {Uint8Array} receiver_private_key
     * @returns {string}
     */
    static decrypt_value(cipher, sender_public_key, receiver_private_key) {
        return asymmetric_decrypt(cipher, receiver_private_key, sender_public_key)
    }

    /**
     * Get a short fingerprint of this secret.
     * @returns {string}
     */
    fingerprint() {
        const txt = `${this.app}:${this.env}:${this.key}:${this.type}:${this.get_value()}`
        return nacl_fingerprint(Buffer.from(txt, 'utf-8'))
    }

    /**
     * Encrypt to a dict for JSON export.
     * @param {Uint8Array} sender_private_key
     * @param {Uint8Array} recipient_public_key
     * @returns {object}
     */
    encrypt_to_dict(sender_private_key, recipient_public_key) {
        return {
            app: this.app,
            env: this.env,
            key: this.key,
            value: this.encrypt_value(sender_private_key, recipient_public_key),
            type: this.type,
        }
    }

    to_plaintext_dict() {
        return {
            app: this.app,
            env: this.env,
            key: this.key,
            type: this.type,
            value: this.get_value(),
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
        return [this.app, this.env, this.key, this.get_value(), this.type]
    }

    toString() {
        return `Secret(${this.app}, ${this.env}, ${this.key}, ${this.get_value()}, ${this.type})`
    }
}
