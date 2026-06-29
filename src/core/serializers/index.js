/**
 * Serializer registry for the `export` / `load` round-trip. Ships
 * with `json-crypt` (NaCl-encrypted JSON — the secure default),
 * `backup` (insecure plaintext JSON — disaster recovery only),
 * plus `env` and `command` plaintext formats for shell consumption.
 *
 * @module core/serializers
 */

export { BaseSerializer, register_serializer, get_serializer, list_serializers } from './base.js'
export { JsonCryptSerializer } from './json-crypt.js'
export { InsecureJsonSerializer } from './backup.js'
export { CommandSerializer } from './command.js'
export { EnvSerializer } from './env.js'
export { UserListSerializer } from './user-list.js'
export {
    ENVELOPE_VERSION,
    MESSAGE_KINDS,
    wrap_envelope,
    parse_envelope,
} from './envelope.js'
