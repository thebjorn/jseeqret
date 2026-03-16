/**
 * Command serializer: outputs commands that can be pasted into a terminal.
 *
 * Compatible with Python seeqret's CommandSerializer.
 */

import { BaseSerializer, register_serializer } from './base.js'
import { Secret } from '../models/secret.js'

export class CommandSerializer extends BaseSerializer {
    static version = 1
    static tag = 'command'
    static description = 'Output list of commands for terminal pasting.'

    dumps(secrets) {
        const lines = secrets.map(s => {
            const encrypted = s.encrypt_value(this.sender_private_key, this.receiver.public_key)
            const fp = s.fingerprint()
            return `jseeqret load -u${this.sender.username} -scommand -v${fp}:${s.app}:${s.env}:${s.key}:${s.type}:${encrypted}`
        })
        return lines.join('\n')
    }

    load(text) {
        const sender_pubkey = this.sender.public_key
        const lines = text.trim().split('\n').filter(l => l.trim())

        return lines.map(line => {
            // Parse: fingerprint:app:env:key:type:encrypted_value
            const parts = line.split(':')
            if (parts.length < 6) throw new Error(`Invalid command format: ${line}`)
            const [fp, app, env, key, type, ...rest] = parts
            const encrypted = rest.join(':')
            const plaintext = Secret.decrypt_value(encrypted, sender_pubkey, this.receiver_private_key)
            return new Secret({
                app,
                env,
                key,
                type: type || 'str',
                plaintext_value: plaintext,
            })
        })
    }
}

register_serializer(CommandSerializer)
