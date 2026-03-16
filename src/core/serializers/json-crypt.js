/**
 * JSON-Crypt serializer: asymmetrically encrypted JSON format.
 *
 * Compatible with Python seeqret's JsonCryptSerializer.
 */

import { BaseSerializer, register_serializer } from './base.js'
import { Secret } from '../models/secret.js'
import { fingerprint } from '../crypto/nacl.js'

export class JsonCryptSerializer extends BaseSerializer {
    static version = 1
    static tag = 'json-crypt'
    static description = 'Asymmetrically encrypted JSON export.'

    dumps(secrets) {
        const encrypted_secrets = secrets.map(s =>
            s.encrypt_to_dict(this.sender_private_key, this.receiver.public_key)
        )

        const payload = {
            version: JsonCryptSerializer.version,
            from: this.sender.username,
            to: this.receiver.username,
            secrets: encrypted_secrets,
            signature: fingerprint(Buffer.from(JSON.stringify(encrypted_secrets), 'utf-8')),
        }

        return JSON.stringify(payload, null, 2)
    }

    load(text) {
        const data = JSON.parse(text)
        const sender_pubkey = this.sender.public_key

        return data.secrets.map(s => {
            const plaintext = Secret.decrypt_value(s.value, sender_pubkey, this.receiver_private_key)
            return new Secret({
                app: s.app,
                env: s.env,
                key: s.key,
                type: s.type || 'str',
                plaintext_value: plaintext,
            })
        })
    }
}

register_serializer(JsonCryptSerializer)
