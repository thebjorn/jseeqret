/**
 * Base serializer class for secret export/import.
 *
 * All serializers must implement dumps() and load() methods.
 */

export class BaseSerializer {
    static version = 1
    static tag = ''
    static description = ''

    /**
     * @param {object} opts
     * @param {object} [opts.sender] - sender User
     * @param {object} [opts.receiver] - receiver User
     * @param {Uint8Array} [opts.sender_private_key]
     * @param {Uint8Array} [opts.receiver_private_key]
     */
    constructor({ sender = null, receiver = null, sender_private_key = null, receiver_private_key = null } = {}) {
        this.sender = sender
        this.receiver = receiver
        this.sender_private_key = sender_private_key
        this.receiver_private_key = receiver_private_key
    }

    /**
     * Serialize secrets to a string.
     * @param {Array} secrets - array of Secret objects
     * @param {string} [system] - target platform ('win32' or 'linux')
     * @returns {string}
     */
    dumps(secrets, system = null) {
        throw new Error('Not implemented')
    }

    /**
     * Deserialize a string to secrets.
     * @param {string} text
     * @returns {Array} array of Secret objects
     */
    load(text) {
        throw new Error('Not implemented')
    }
}

/** Registry of serializer classes by tag */
const _registry = {}

export function register_serializer(cls) {
    _registry[cls.tag] = cls
}

export function get_serializer(tag) {
    const cls = _registry[tag]
    if (!cls) throw new Error(`Unknown serializer: ${tag}`)
    return cls
}

export function list_serializers() {
    return Object.values(_registry)
}
