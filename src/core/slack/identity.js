/**
 * Slack handle to NaCl public key binding.
 *
 * Implements security-concerns.md #4: a Slack handle is NEVER trusted as
 * a source of public-key material. Before jseeqret will send ciphertext
 * to `@bob` via Slack, the operator must have run
 * `jseeqret slack link bob` and typed the 5-character fingerprint of
 * bob's pubkey back at a confirmation prompt (out-of-band verification).
 *
 * The fingerprint is cached in the users table. Any later mismatch -- for
 * example if the local users row is rewritten by an attacker or the key
 * is rotated without a fresh `slack link` -- causes send() to refuse.
 */

import { fingerprint as nacl_fingerprint } from '../crypto/nacl.js'

/**
 * Compute the 5-character fingerprint of a user's public key. This is
 * the exact same function used by `nacl.fingerprint`; centralizing it
 * here keeps the Slack code path self-documenting.
 *
 * @param {import('../models/user.js').User} user
 * @returns {string}
 */
export function compute_fingerprint(user) {
    // Hash the raw 32-byte pubkey (not the base64 string) so the
    // fingerprint matches the Python `nacl_backend.fingerprint(pk.encode())`
    // that seeqret uses.
    return nacl_fingerprint(Buffer.from(user.public_key))
}

/**
 * Record a slack handle binding after the operator has confirmed the
 * fingerprint out-of-band.
 *
 * Callers (the CLI) are responsible for showing the fingerprint and
 * collecting the confirmation; this function only persists the result.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} username - local user to bind
 * @param {string} slack_handle - e.g. 'bob' (no leading @)
 * @returns {Promise<{user: import('../models/user.js').User, fingerprint: string}>}
 */
export async function bind_slack_handle(storage, username, slack_handle) {
    const user = await storage.fetch_user(username)
    if (!user) {
        throw new Error(`Unknown local user: ${username}`)
    }

    const fp = compute_fingerprint(user)
    const now = Math.floor(Date.now() / 1000)

    await storage.update_user_slack(username, {
        slack_handle,
        slack_key_fingerprint: fp,
        slack_verified_at: now,
    })

    return { user, fingerprint: fp }
}

/**
 * Assert that the stored fingerprint still matches the current pubkey
 * and the user is actually linked to a Slack handle. Used by `send`
 * to refuse to push ciphertext via Slack if the binding has drifted.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} username
 * @returns {Promise<{user: import('../models/user.js').User, slack_handle: string}>}
 * @throws if the user is not linked or the fingerprint no longer matches
 */
export async function require_verified_binding(storage, username) {
    const user = await storage.fetch_user(username)
    if (!user) {
        throw new Error(`Unknown local user: ${username}`)
    }
    if (!user.slack_handle) {
        throw new Error(
            `User '${username}' is not linked to a Slack handle.`
            + ` Run: jseeqret slack link ${username}`
        )
    }
    if (!user.slack_key_fingerprint) {
        throw new Error(
            `User '${username}' has no stored Slack fingerprint.`
            + ` Re-run: jseeqret slack link ${username}`
        )
    }

    const current = compute_fingerprint(user)
    if (current !== user.slack_key_fingerprint) {
        throw new Error(
            `Refusing to send to '${username}' via Slack:`
            + ` stored fingerprint ${user.slack_key_fingerprint}`
            + ` no longer matches current pubkey fingerprint ${current}.`
            + ` Re-verify out-of-band and re-run: jseeqret slack link ${username}`
        )
    }

    return { user, slack_handle: user.slack_handle }
}

/**
 * Find the local user that corresponds to an inbound Slack handle. Used
 * by `receive` to resolve a sender. Returns null if no local user has
 * that handle.
 *
 * Note: `receive` authenticates senders via NaCl Box (the sender's pubkey
 * is an input to asymmetric_decrypt); this lookup just tells us which
 * user record to use for that key. An attacker who can post as `@bob` on
 * Slack but who does not hold bob's NaCl private key cannot produce a
 * blob that decrypts under bob's pubkey.
 *
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} slack_handle
 * @returns {Promise<import('../models/user.js').User|null>}
 */
export async function find_user_by_slack_handle(storage, slack_handle) {
    const users = await storage.fetch_users({})
    for (const u of users) {
        if (u.slack_handle === slack_handle) return u
    }
    return null
}
