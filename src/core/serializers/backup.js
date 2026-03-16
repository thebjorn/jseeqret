/**
 * Insecure JSON serializer for vault backup.
 *
 * WARNING: Exports plaintext secrets. Use only for trusted local backups.
 * Compatible with Python seeqret's InsecureJsonSerializer.
 */

import { BaseSerializer, register_serializer } from './base.js'
import { Secret } from '../models/secret.js'
import { fingerprint } from '../crypto/nacl.js'

export class InsecureJsonSerializer extends BaseSerializer {
    static version = 1
    static tag = 'backup'
    static description = 'Plaintext JSON backup (insecure).'

    dumps(secrets) {
        const plaintext_secrets = secrets.map(s => s.to_plaintext_dict())

        const payload = {
            version: InsecureJsonSerializer.version,
            from: this.sender?.username || 'self',
            to: this.receiver?.username || 'self',
            secrets: plaintext_secrets,
            signature: fingerprint(Buffer.from(JSON.stringify(plaintext_secrets), 'utf-8')),
        }

        return JSON.stringify(payload, null, 2)
    }

    load(text) {
        const data = JSON.parse(text)
        return data.secrets.map(s => new Secret({
            app: s.app,
            env: s.env,
            key: s.key,
            type: s.type || 'str',
            plaintext_value: String(s.value),
        }))
    }
}

register_serializer(InsecureJsonSerializer)
