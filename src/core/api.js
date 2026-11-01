/**
 * Public API for jseeqret.
 *
 * Usage:
 *   import { get } from 'jseeqret'
 *   const value = await get('myapp:prod:DB_PASSWORD')
 *   const same = await get('DB_PASSWORD', 'myapp', 'prod')
 *
 * The database and symmetric key are cached on first access for fast
 * repeated lookups. Call `close()` to release resources.
 */

import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { get_seeqret_dir } from './vault.js'
import { decrypt } from './crypto/fernet.js'
import { sql_where_clause } from './filter.js'
import { AmbiguousSecret, SecretNotFound } from './errors.js'

export { AmbiguousSecret, SecretNotFound }

let _db = null
let _key = null
let _vault_dir = null
let _SQL = null

function cnvt(typename, val) {
    if (typename === 'int') return parseInt(val, 10)
    return val
}

/**
 * Ensure the cached db and key are loaded.
 * Synchronous after first init (sql.js WASM load is async).
 */
async function _ensure_loaded() {
    const vault_dir = get_seeqret_dir()

    // If vault dir changed, reset cache
    if (_vault_dir !== vault_dir) {
        _close()
        _vault_dir = vault_dir
    }

    if (!_key) {
        _key = fs.readFileSync(path.join(vault_dir, 'seeqret.key'), 'utf-8').trim()
    }

    if (!_db) {
        if (!_SQL) {
            _SQL = await initSqlJs()
        }
        const buf = fs.readFileSync(path.join(vault_dir, 'seeqrets.db'))
        _db = new _SQL.Database(buf)
    }
}

function _close() {
    if (_db) {
        _db.close()
        _db = null
    }
    _key = null
    _vault_dir = null
}

/**
 * Split an `app:env:key` reference into `[key, app, env]`.
 *
 * A bare key is returned unchanged with the given app/env. Empty parts
 * of a reference mean `*`, as in the CLI (`::KEY` is `*:*:KEY`).
 *
 * @param {string} key - key name or `app:env:key` reference
 * @param {string} [app='*']
 * @param {string} [env='*']
 * @returns {[string, string, string]} `[key, app, env]`
 * @throws {Error} the reference is malformed, or it names app/env and
 *     app/env were also passed explicitly
 */
export function parse_reference(key, app = '*', env = '*') {
    if (!key.includes(':')) {
        return [key, app, env]
    }

    const parts = key.split(':')
    if (parts.length !== 3 || !parts[2]) {
        throw new Error(
            `Invalid secret reference '${key}': expected KEY or APP:ENV:KEY, `
            + `e.g. 'myapp:prod:DB_PASSWORD'.`
        )
    }
    if (app !== '*' || env !== '*') {
        throw new Error(
            `'${key}' already names app and env; do not also pass `
            + `app='${app}'/env='${env}'.`
        )
    }

    const [ref_app, ref_env, ref_key] = parts
    return [ref_key, ref_app || '*', ref_env || '*']
}

/**
 * Get a secret value from the vault (async, first call initializes cache).
 *
 * The secret can be named like on the command line:
 *
 *     await get('myapp:prod:DB_PASSWORD')
 *     await get('DB_PASSWORD', 'myapp', 'prod')     // same thing
 *
 * `*` and other glob characters are wildcards, and the lookup must match
 * exactly one secret.
 *
 * @param {string} key - key name, or an `app:env:key` reference (empty
 *     parts mean `*`)
 * @param {string} [app='*'] - application name (only with a bare key)
 * @param {string} [env='*'] - environment name (only with a bare key)
 * @returns {Promise<string|number>} decrypted value
 * @throws {SecretNotFound} no secret matches
 * @throws {AmbiguousSecret} more than one secret matches
 * @throws {Error} the reference is malformed or conflicts with app/env
 */
export async function get(key, app = '*', env = '*') {
    // validate before touching the vault, so a malformed reference is
    // reported as such even when no vault is configured
    const ref = parse_reference(key, app, env)
    await _ensure_loaded()
    return _get_sync(...ref)
}

/**
 * Synchronous get -- only works after `init()` has been called. Takes
 * the same arguments and throws the same errors as `get()`.
 *
 * @param {string} key
 * @param {string} [app='*']
 * @param {string} [env='*']
 * @returns {string|number}
 */
export function get_sync(key, app = '*', env = '*') {
    if (!_db || !_key) {
        throw new Error('jseeqret not initialized. Call await init() first.')
    }
    return _get_sync(...parse_reference(key, app, env))
}

function _get_sync(key, app, env) {
    const { clause, params } = sql_where_clause({ app, env, key })
    const stmt = _db.prepare(`SELECT app, env, key, value, type FROM secrets${clause}`)
    const rows = []
    try {
        stmt.bind(params)
        while (stmt.step()) {
            rows.push(stmt.getAsObject())
        }
    } finally {
        stmt.free()
    }

    if (rows.length === 0) {
        throw new SecretNotFound(key, app, env, path.join(_vault_dir, 'seeqrets.db'))
    }
    if (rows.length > 1) {
        throw new AmbiguousSecret(key, app, env, rows)
    }

    const plaintext = decrypt(_key, rows[0].value).toString('utf-8')
    return cnvt(rows[0].type, plaintext)
}

/**
 * Initialize the cache (load WASM, open database, read key).
 * Call this once at startup for fastest subsequent `get_sync()` calls.
 */
export async function init() {
    await _ensure_loaded()
}

/**
 * Close the cached database and release resources.
 */
export function close() {
    _close()
}

/**
 * Reload the database from disk (picks up changes made by other tools).
 */
export async function reload() {
    _close()
    await _ensure_loaded()
}
