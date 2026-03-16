/**
 * Env serializer: exports secrets in .env file format.
 *
 * Compatible with Python seeqret's EnvSerializer.
 */

import { BaseSerializer, register_serializer } from './base.js'

export class EnvSerializer extends BaseSerializer {
    static version = 1
    static tag = 'env'
    static description = 'Export to .env file format.'

    dumps(secrets) {
        return secrets.map(s => `${s.key}="${s.get_value()}"`).join('\n')
    }

    load(text) {
        throw new Error('EnvSerializer does not support loading')
    }
}

register_serializer(EnvSerializer)
