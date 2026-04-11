/**
 * Fernet-wrapped Slack configuration store.
 *
 * All Slack tokens and channel metadata live in the vault's `kv` table
 * (see migration v003). Values are JSON-serialized, Fernet-encrypted
 * with the vault's symmetric key, and written as BLOB.
 *
 * This wraps security-concerns.md #3: the Slack user token gets the same
 * at-rest protection as any other secret in the vault, and never touches
 * disk in plaintext.
 */

import { encrypt as fernet_encrypt, decrypt as fernet_decrypt } from '../crypto/fernet.js'
import { load_symmetric_key } from '../crypto/utils.js'
import { get_seeqret_dir } from '../vault.js'

export const SLACK_KV_PREFIX = 'slack.'

export const SLACK_KEYS = {
    user_token:          'slack.user_token',
    team_id:             'slack.team_id',
    team_name:           'slack.team_name',
    user_id:             'slack.user_id',
    channel_id:          'slack.channel_id',
    channel_name:        'slack.channel_name',
    last_seen_ts:        'slack.last_seen_ts',
    connected_apps_hash: 'slack.connected_apps_hash',
    token_created_at:    'slack.token_created_at',
    mfa_attested_at:     'slack.mfa_attested_at',
}

function _key_for(storage) {
    const vault_dir = storage.vault_dir || get_seeqret_dir()
    return load_symmetric_key(vault_dir)
}

/**
 * Fetch and decrypt a Slack config value. Returns null if absent.
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} key
 * @returns {Promise<any|null>} the JSON-deserialized value
 */
export async function slack_config_get(storage, key) {
    const blob = await storage.kv_get(key)
    if (blob == null) return null

    const fernet_key = _key_for(storage)
    // kv stores the Fernet token as its base64url bytes
    const token_str = blob.toString('utf-8')
    const plaintext = fernet_decrypt(fernet_key, token_str)
    return JSON.parse(plaintext.toString('utf-8'))
}

/**
 * Fernet-encrypt a Slack config value and upsert into the kv table.
 * @param {import('../sqlite-storage.js').SqliteStorage} storage
 * @param {string} key
 * @param {any} value - JSON-serializable
 */
export async function slack_config_set(storage, key, value) {
    const fernet_key = _key_for(storage)
    const plaintext = Buffer.from(JSON.stringify(value), 'utf-8')
    const token_str = fernet_encrypt(fernet_key, plaintext)
    await storage.kv_set(key, Buffer.from(token_str, 'utf-8'))
}

/**
 * Delete a single Slack config key.
 */
export async function slack_config_delete(storage, key) {
    await storage.kv_delete(key)
}

/**
 * Wipe every `slack.*` kv entry. Used by `jseeqret slack logout`.
 */
export async function slack_config_clear_all(storage) {
    await storage.kv_delete_prefix(SLACK_KV_PREFIX)
}

/**
 * Convenience: fetch everything slack_config_get() knows about in one go.
 * Missing keys are returned as null.
 */
export async function slack_config_snapshot(storage) {
    const out = {}
    for (const [name, key] of Object.entries(SLACK_KEYS)) {
        out[name] = await slack_config_get(storage, key)
    }
    return out
}
