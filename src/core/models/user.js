/**
 * User model - compatible with Python seeqret's User class.
 */

import { decode_key } from '../crypto/nacl.js'

export class User {
    /**
     * @param {string} username
     * @param {string} email
     * @param {string} pubkey - base64-encoded public key
     */
    constructor(username, email, pubkey) {
        this.username = username
        this.email = email
        this.pubkey = pubkey
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
        }
    }

    toString() {
        return `User(${this.username}, ${this.email}, ${this.pubkey})`
    }
}
