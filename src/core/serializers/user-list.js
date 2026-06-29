/**
 * User-list serializer: a NaCl-encrypted list of user records.
 *
 * Onboarding ships *users* (not just secrets) over the channel so a new
 * teammate's vault learns the existing teammates' public keys (steps
 * 12-13) and so existing teammates learn the newcomer's key (resolved
 * question 1). The whole list is encrypted as a single NaCl Box from the
 * sender to the receiver, so:
 *
 *   - the username -> pubkey *binding* is authenticated end to end (an
 *     attacker on Slack cannot swap a name onto someone else's key), and
 *   - decryption only succeeds for the intended recipient and proves the
 *     sender's identity (Box authenticates), which is what lets the
 *     receiver accept the keys "on the team lead's authority" (trust
 *     model rule 2 in the onboarding plan).
 *
 * Mirrors json-crypt.js's envelope shape (version/from/to/signature) for
 * consistency with the existing secret path.
 */

import { BaseSerializer, register_serializer } from './base.js'
import { User } from '../models/user.js'
import {
    asymmetric_encrypt,
    asymmetric_decrypt,
    fingerprint,
} from '../crypto/nacl.js'

export class UserListSerializer extends BaseSerializer {
    static version = 1
    static tag = 'user-list'
    static description = 'NaCl-encrypted list of user records (pubkeys).'

    dumps(users) {
        const records = users.map(u => ({
            username: u.username,
            email: u.email,
            pubkey: u.pubkey,
        }))

        const encrypted = asymmetric_encrypt(
            JSON.stringify(records),
            this.sender_private_key,
            this.receiver.public_key,
        )

        const payload = {
            version: UserListSerializer.version,
            from: this.sender.username,
            to: this.receiver.username,
            users: encrypted,
            signature: fingerprint(Buffer.from(encrypted, 'utf-8')),
        }

        return JSON.stringify(payload, null, 2)
    }

    load(text) {
        const data = JSON.parse(text)
        const sender_pubkey = this.sender.public_key

        const plaintext = asymmetric_decrypt(
            data.users,
            this.receiver_private_key,
            sender_pubkey,
        )
        const records = JSON.parse(plaintext)

        return records.map(r => new User(r.username, r.email, r.pubkey))
    }
}

register_serializer(UserListSerializer)
