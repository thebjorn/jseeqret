/**
 * Typed message envelope for the Slack exchange / onboarding transport.
 *
 * Today's secret blobs are a bare JSON object (`{ version, from, to,
 * secrets, signature }`) with no type tag. Onboarding adds several more
 * message kinds that travel over the same pipe, so the receiver needs to
 * know what it is decrypting before it tries.
 *
 * An envelope wraps the (already kind-specific) payload in a thin
 * `{ v, kind, payload }` object. The encryption boundary is unchanged:
 * the payload's sensitive fields are still NaCl-encrypted by the relevant
 * serializer; the envelope itself is plaintext structure, exactly like the
 * existing secret blob whose app:env:key are visible and values encrypted.
 *
 * Backward compatibility: a blob with no `kind` is a legacy secret export,
 * so `parse_envelope` reports it as kind `secret` with the whole object as
 * the payload. Blobs already in flight keep decoding.
 */

export const ENVELOPE_VERSION = 1

/**
 * The message kinds that travel over the exchange channel.
 *  - secret        legacy / ad-hoc secret export (json-crypt)
 *  - invite        TL -> user: download link + TL identity (steps 1-4)
 *  - introduction  user -> TL: the user's pubkey + fingerprint (step 7)
 *  - user_list     TL -> user: teammate records (steps 12-13)
 *  - secret_batch  TL -> user: project-scoped secrets (steps 14-15)
 *  - complete      TL -> user: onboarding finished ack (step 16)
 */
export const MESSAGE_KINDS = {
    secret: 'secret',
    invite: 'invite',
    introduction: 'introduction',
    user_list: 'user_list',
    secret_batch: 'secret_batch',
    complete: 'complete',
}

/**
 * Wrap a kind-specific payload in a typed envelope.
 * @param {string} kind - one of MESSAGE_KINDS
 * @param {any} payload - JSON-serializable payload
 * @returns {string} the envelope JSON text (the transport "ciphertext")
 */
export function wrap_envelope(kind, payload) {
    return JSON.stringify({
        v: ENVELOPE_VERSION,
        kind,
        payload,
    })
}

/**
 * Parse an envelope. A blob without a `kind`/`payload` pair is treated as
 * a legacy secret export (the whole object is the payload).
 *
 * @param {string} text - the envelope JSON text
 * @returns {{ kind: string, payload: any, version: number|null }}
 */
export function parse_envelope(text) {
    const data = JSON.parse(text)

    if (data && typeof data === 'object'
        && typeof data.kind === 'string' && 'payload' in data) {
        return {
            kind: data.kind,
            payload: data.payload,
            version: data.v ?? null,
        }
    }

    return {
        kind: MESSAGE_KINDS.secret,
        payload: data,
        version: null,
    }
}
