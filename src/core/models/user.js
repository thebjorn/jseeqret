/**
 * User model - compatible with Python seeqret's User class.
 */

import { decode_key } from '../crypto/nacl.js'

export class User {
    /**
     * @param {string} username
     * @param {string} email
     * @param {string} pubkey - base64-encoded public key
     * @param {object} [extras]
     * @param {string} [extras.slack_handle]
     * @param {string} [extras.slack_key_fingerprint]
     * @param {number} [extras.slack_verified_at] - unix seconds
     */
    constructor(username, email, pubkey, extras = {}) {
        this.username = username
        this.email = email
        this.pubkey = pubkey
        this.slack_handle = extras.slack_handle || null
        this.slack_key_fingerprint = extras.slack_key_fingerprint || null
        this.slack_verified_at = extras.slack_verified_at || null
    }

    /**
     * Get the public key as a Uint8Array.
     * @returns {Uint8Array}
     */
    get public_key() {
        return decode_key(this.pubkey)
    }

    get row() {
        return [this.username, this.email, this.pubkey]
    }

    toJSON() {
        return {
            username: this.username,
            email: this.email,
            pubkey: this.pubkey,
            slack_handle: this.slack_handle,
            slack_key_fingerprint: this.slack_key_fingerprint,
            slack_verified_at: this.slack_verified_at,
        }
    }

    toString() {
        return `User(${this.username}, ${this.email}, ${this.pubkey})`
    }
}
