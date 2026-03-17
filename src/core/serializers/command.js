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

    dumps(secrets, system = null) {
        const target = system || process.platform
        const line_ending = target === 'win32' ? '\r\n' : '\n'

        const lines = secrets.map(s => {
            const encrypted = s.encrypt_value(this.sender_private_key, this.receiver.public_key)
            const fp = s.fingerprint()
            return `jseeqret load -u${this.sender.username} -scommand -v${fp}:${s.app}:${s.env}:${s.key}:${s.type}:${encrypted}`
        })
        return lines.join(line_ending)
    }

    load(text) {
        const sender_pubkey = this.sender.public_key
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim())

        return lines.map(line => {
            // Strip command prefix if present (file-based input)
            // Full line: jseeqret load -uUSER -scommand -vFP:APP:...
            let value_str = line
            const flag_match = line.match(/-v(.+)$/)
            if (flag_match) {
                value_str = flag_match[1]
            }

            // Parse: fingerprint:app:env:key:type:encrypted_value
            const parts = value_str.split(':')
            if (parts.length < 6) {
                throw new Error(
                    `Invalid command format: ${line}`
                )
            }
            const [fp, app, env, key, type, ...rest] = parts
            const encrypted = rest.join(':')
            const plaintext = Secret.decrypt_value(
                encrypted, sender_pubkey,
                this.receiver_private_key,
            )
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
