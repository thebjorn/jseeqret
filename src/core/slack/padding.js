/**
 * Size-bucket padding for Slack-exchange ciphertext blobs.
 *
 * Why: Slack exposes file sizes to every channel member and to workspace
 * admins. An unpadded ciphertext leaks the number of secrets per export
 * and supports correlation attacks (security-concerns.md #2). Padding to
 * a fixed bucket defeats that.
 *
 * Format (big-endian):
 *   [4-byte length prefix] [payload bytes] [random padding up to bucket]
 *
 * The length prefix is the real payload length in bytes. The receiver
 * uses it to strip the random tail before passing the ciphertext to
 * asymmetric_decrypt.
 *
 * The bucket size MUST match the Python implementation exactly so that
 * blobs can travel between jseeqret and seeqret.
 */

import { randomBytes } from 'crypto'

export const DEFAULT_BUCKET = 4096

/**
 * Pad a payload to the next multiple of bucket bytes.
 * @param {Buffer|Uint8Array} payload - the ciphertext bytes
 * @param {number} [bucket=DEFAULT_BUCKET]
 * @returns {Buffer}
 */
export function pad_to_bucket(payload, bucket = DEFAULT_BUCKET) {
    const payload_buf = Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(payload)

    const prefix_len = 4
    const total_len = prefix_len + payload_buf.length

    // Round up to the nearest bucket boundary. The prefix itself counts
    // toward the bucket size so the final blob is exactly N * bucket.
    const padded_total = Math.ceil(total_len / bucket) * bucket
    const pad_len = padded_total - total_len

    const prefix = Buffer.alloc(prefix_len)
    prefix.writeUInt32BE(payload_buf.length, 0)

    const pad_bytes = pad_len > 0 ? randomBytes(pad_len) : Buffer.alloc(0)

    return Buffer.concat([prefix, payload_buf, pad_bytes], padded_total)
}

/**
 * Strip the length prefix and random padding from a padded blob.
 * @param {Buffer|Uint8Array} padded
 * @returns {Buffer} the original payload bytes
 */
export function unpad_from_bucket(padded) {
    const buf = Buffer.isBuffer(padded) ? padded : Buffer.from(padded)

    if (buf.length < 4) {
        throw new Error('padded blob is shorter than the length prefix')
    }

    const payload_len = buf.readUInt32BE(0)

    if (payload_len < 0 || payload_len > buf.length - 4) {
        throw new Error(
            `padded blob claims payload_len=${payload_len}`
            + ` but only ${buf.length - 4} bytes follow the prefix`
        )
    }

    return buf.subarray(4, 4 + payload_len)
}
