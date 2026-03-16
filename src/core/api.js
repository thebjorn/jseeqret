/**
 * Public API for jseeqret.
 *
 * Usage:
 *   import { get } from 'jseeqret'
 *   const value = get('DB_PASSWORD', 'myapp', 'prod')
 *
 * The database and symmetric key are cached on first access for fast
 * repeated lookups. Call `close()` to release resources.
 */

import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { get_seeqret_dir } from './vault.js'
import { decrypt } from './crypto/fernet.js'

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
 * Get a secret value from the vault (async, first call initializes cache).
 *
 * @param {string} key - secret key name
 * @param {string} [app='*'] - application name
 * @param {string} [env='*'] - environment name
 * @returns {Promise<string|number>} decrypted value
 */
export async function get(key, app = '*', env = '*') {
    await _ensure_loaded()
    return _get_sync(key, app, env)
}

/**
 * Synchronous get -- only works after `init()` has been called.
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
    return _get_sync(key, app, env)
}

function _get_sync(key, app, env) {
    const stmt = _db.prepare(
        'SELECT value, type FROM secrets WHERE key = ? AND app = ? AND env = ?'
    )
    stmt.bind([key, app, env])

    if (!stmt.step()) {
        stmt.free()
        throw new Error(`Secret not found: ${app}:${env}:${key}`)
    }

    const row = stmt.getAsObject()
    stmt.free()

    const plaintext = decrypt(_key, row.value).toString('utf-8')
    return cnvt(row.type, plaintext)
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
