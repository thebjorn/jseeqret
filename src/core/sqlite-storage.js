/**
 * SQLite storage backend - compatible with Python seeqret's SqliteStorage.
 *
 * Uses sql.js (pure JS/WASM SQLite) to avoid native compilation.
 * Reads/writes the database file on each operation for compatibility
 * with the Python seeqret tool.
 */

import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { get_seeqret_dir } from './vault.js'
import { Secret } from './models/secret.js'
import { User } from './models/user.js'
import { glob_to_sql, has_glob_chars } from './filter.js'

let SQL = null

/**
 * Initialize the sql.js WASM module (cached after first call).
 */
async function getSQL() {
    if (!SQL) {
        SQL = await initSqlJs()
    }
    return SQL
}

export class SqliteStorage {
    /**
     * @param {string} [fname='seeqrets.db']
     * @param {string} [vault_dir] - override vault directory
     */
    constructor(fname = 'seeqrets.db', vault_dir = null) {
        this.fname = fname
        this._vault_dir = vault_dir
    }

    get vault_dir() {
        return this._vault_dir || get_seeqret_dir()
    }

    get db_path() {
        return path.join(this.vault_dir, this.fname)
    }

    /**
     * Open the database, run a callback, and save if modified.
     * @param {function} fn - receives the sql.js Database instance
     * @param {boolean} [write=false] - whether to save changes back to disk
     * @returns {any} return value of fn
     */
    async _with_db(fn, write = false) {
        const SQL = await getSQL()
        let db

        if (fs.existsSync(this.db_path)) {
            const file_buffer = fs.readFileSync(this.db_path)
            db = new SQL.Database(file_buffer)
        } else {
            db = new SQL.Database()
        }

        try {
            const result = fn(db)

            if (write) {
                const data = db.export()
                fs.writeFileSync(this.db_path, Buffer.from(data))
            }

            return result
        } finally {
            db.close()
        }
    }

    /**
     * Build a WHERE field clause with parameter.
     */
    _where_field(field, value) {
        if (has_glob_chars(value)) {
            return { clause: `${field} LIKE ?`, params: [glob_to_sql(value)] }
        }
        return { clause: `${field} = ?`, params: [value] }
    }

    /**
     * Build an OR clause for comma-separated values.
     */
    _where_field_or(field, values) {
        const clauses = []
        const params = []

        for (const v of values) {
            if (v === '*') {
                clauses.push(`${field} LIKE ?`)
                params.push('%')
            } else {
                const { clause, params: p } = this._where_field(field, v)
                clauses.push(clause)
                params.push(...p)
            }
        }

        return { clause: `(${clauses.join(' OR ')})`, params }
    }

    /**
     * Build a full WHERE clause from a filter dict.
     */
    _where_clause(filters) {
        if (!filters || Object.keys(filters).length === 0) {
            return { clause: '', params: [] }
        }

        const clauses = []
        const params = []

        for (const [k, v] of Object.entries(filters)) {
            if (v.includes(',')) {
                const { clause, params: p } = this._where_field_or(k, v.split(','))
                clauses.push(clause)
                params.push(...p)
            } else {
                const { clause, params: p } = this._where_field(k, v)
                clauses.push(clause)
                params.push(...p)
            }
        }

        return {
            clause: ' WHERE ' + clauses.join(' AND '),
            params,
        }
    }

    /**
     * Execute a query and return rows as objects.
     */
    _query_rows(db, sql, params = []) {
        const stmt = db.prepare(sql)
        stmt.bind(params)

        const rows = []
        while (stmt.step()) {
            rows.push(stmt.getAsObject())
        }

        stmt.free()
        return rows
    }

    /**
     * Execute a SQL query with filters.
     */
    async execute_sql(sql, filters = {}) {
        return this._with_db((db) => {
            let order_by = ''

            if (Array.isArray(sql)) {
                ;[sql, order_by] = sql
            }

            const { clause, params } = this._where_clause(filters)
            const full_sql = sql + clause + order_by
            return this._query_rows(db, full_sql, params)
        })
    }

    /**
     * Execute a write SQL statement with filters.
     */
    async execute_write_sql(sql, filters = {}) {
        return this._with_db((db) => {
            let order_by = ''

            if (Array.isArray(sql)) {
                ;[sql, order_by] = sql
            }

            const { clause, params } = this._where_clause(filters)
            const full_sql = sql + clause + order_by
            db.run(full_sql, params)
        }, true)
    }

    // ---- User operations ----

    /**
     * Hydrate a User from a row object. Extra slack_* fields are optional
     * so callers can select a narrower column set when they don't need them.
     */
    _user_from_row(r) {
        return new User(r.username, r.email, r.pubkey, {
            name: r.name,
            slack_handle: r.slack_handle,
            slack_key_fingerprint: r.slack_key_fingerprint,
            slack_verified_at: r.slack_verified_at,
        })
    }

    async add_user(user) {
        return this._with_db((db) => {
            db.run(
                'INSERT INTO users (username, email, pubkey, name)'
                + ' VALUES (?, ?, ?, ?)',
                [user.username, user.email, user.pubkey, user.name ?? null]
            )
        }, true)
    }

    async remove_user(username) {
        return this._with_db((db) => {
            db.run('DELETE FROM users WHERE username = ?', [username])
        }, true)
    }

    async fetch_user(username) {
        return this._with_db((db) => {
            const rows = this._query_rows(
                db,
                `SELECT username, email, pubkey, name,
                        slack_handle, slack_key_fingerprint, slack_verified_at
                 FROM users WHERE username = ?`,
                [username]
            )
            return rows.length > 0 ? this._user_from_row(rows[0]) : null
        })
    }

    async fetch_users(filters = {}) {
        const rows = await this.execute_sql(
            [
                `SELECT username, email, pubkey, name,
                        slack_handle, slack_key_fingerprint, slack_verified_at
                 FROM users`,
                ' ORDER BY username',
            ],
            filters
        )
        return rows.map(r => this._user_from_row(r))
    }

    async fetch_admin() {
        return this._with_db((db) => {
            const rows = this._query_rows(
                db,
                `SELECT username, email, pubkey, name,
                        slack_handle, slack_key_fingerprint, slack_verified_at
                 FROM users WHERE id = 1`
            )
            return rows.length > 0 ? this._user_from_row(rows[0]) : null
        })
    }

    /**
     * Update a subset of mutable user columns (name, email, pubkey).
     * Unknown keys are ignored; an empty update is a no-op. Changing the
     * pubkey invalidates any verified Slack binding (the stored
     * fingerprint no longer matches the key), so the binding columns are
     * cleared in the same write.
     * @param {string} username
     * @param {object} fields
     * @param {string|null} [fields.name]
     * @param {string} [fields.email]
     * @param {string} [fields.pubkey]
     */
    async update_user(username, fields) {
        const allowed = ['name', 'email', 'pubkey']
        const sets = []
        const params = []

        for (const col of allowed) {
            if (col in fields) {
                sets.push(`${col} = ?`)
                params.push(fields[col])
            }
        }
        if (sets.length === 0) return

        return this._with_db((db) => {
            if ('pubkey' in fields) {
                const rows = this._query_rows(
                    db, 'SELECT pubkey FROM users WHERE username = ?',
                    [username]
                )
                if (rows.length > 0 && rows[0].pubkey !== fields.pubkey) {
                    sets.push('slack_key_fingerprint = NULL')
                    sets.push('slack_verified_at = NULL')
                }
            }
            db.run(
                `UPDATE users SET ${sets.join(', ')} WHERE username = ?`,
                [...params, username]
            )
        }, true)
    }

    /**
     * Update the slack identity binding for a user.
     * @param {string} username
     * @param {object} fields
     * @param {string|null} [fields.slack_handle]
     * @param {string|null} [fields.slack_key_fingerprint]
     * @param {number|null} [fields.slack_verified_at] - unix seconds
     */
    async update_user_slack(username, fields) {
        return this._with_db((db) => {
            db.run(
                `UPDATE users
                 SET slack_handle = ?,
                     slack_key_fingerprint = ?,
                     slack_verified_at = ?
                 WHERE username = ?`,
                [
                    fields.slack_handle ?? null,
                    fields.slack_key_fingerprint ?? null,
                    fields.slack_verified_at ?? null,
                    username,
                ]
            )
        }, true)
    }

    // ---- Encrypted key-value store (for Slack tokens / channel config) ----

    /**
     * Fetch a raw encrypted blob from the kv table. Callers are responsible
     * for Fernet-unwrapping the returned value.
     * @param {string} key
     * @returns {Promise<Buffer|null>}
     */
    async kv_get(key) {
        return this._with_db((db) => {
            const rows = this._query_rows(
                db,
                'SELECT encrypted_value FROM kv WHERE key = ?',
                [key]
            )
            if (rows.length === 0) return null
            const val = rows[0].encrypted_value
            return val == null ? null : Buffer.from(val)
        })
    }

    /**
     * Upsert a kv row. The value must already be Fernet-encrypted.
     * @param {string} key
     * @param {Buffer|Uint8Array|string} encrypted_value
     */
    async kv_set(key, encrypted_value) {
        const blob = Buffer.isBuffer(encrypted_value)
            ? encrypted_value
            : Buffer.from(encrypted_value)
        const now = Math.floor(Date.now() / 1000)
        return this._with_db((db) => {
            db.run(
                `INSERT INTO kv (key, encrypted_value, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET
                     encrypted_value = excluded.encrypted_value,
                     updated_at = excluded.updated_at`,
                [key, blob, now]
            )
        }, true)
    }

    /**
     * Delete a single kv row.
     * @param {string} key
     */
    async kv_delete(key) {
        return this._with_db((db) => {
            db.run('DELETE FROM kv WHERE key = ?', [key])
        }, true)
    }

    /**
     * Delete every kv row whose key starts with the given prefix.
     * Used by `jseeqret slack logout` to wipe all slack.* entries.
     * @param {string} prefix
     */
    async kv_delete_prefix(prefix) {
        return this._with_db((db) => {
            db.run('DELETE FROM kv WHERE key LIKE ?', [prefix + '%'])
        }, true)
    }

    /**
     * List (key, updated_at) pairs with a given prefix. Does not return
     * the encrypted value.
     * @param {string} prefix
     * @returns {Promise<Array<{key: string, updated_at: number}>>}
     */
    async kv_list_prefix(prefix) {
        return this._with_db((db) => {
            return this._query_rows(
                db,
                'SELECT key, updated_at FROM kv WHERE key LIKE ? ORDER BY key',
                [prefix + '%']
            )
        })
    }

    // ---- Secret operations ----

    async add_secret(secret) {
        return this._with_db((db) => {
            db.run(
                'INSERT INTO secrets (app, env, key, value, type) VALUES (?, ?, ?, ?, ?)',
                [secret.app, secret.env, secret.key, secret.encrypted_value, secret.type]
            )
        }, true)
    }

    async update_secret(secret) {
        return this._with_db((db) => {
            db.run(
                'UPDATE secrets SET value = ? WHERE app = ? AND env = ? AND key = ?',
                [secret.encrypted_value, secret.app, secret.env, secret.key]
            )
        }, true)
    }

    /**
     * Insert a secret, or overwrite the value/type if one already exists
     * for the same (app, env, key). Lets `load` / `receive` re-import an
     * updated export instead of failing on the unique constraint.
     */
    async upsert_secret(secret) {
        return this._with_db((db) => {
            db.run(
                `INSERT INTO secrets (app, env, key, value, type)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(app, env, key) DO UPDATE SET
                     value = excluded.value,
                     type = excluded.type`,
                [secret.app, secret.env, secret.key, secret.encrypted_value, secret.type]
            )
        }, true)
    }

    async fetch_secrets(filters = {}) {
        const rows = await this.execute_sql(
            'SELECT app, env, key, value, type FROM secrets',
            filters
        )
        return rows.map(r => new Secret({
            app: r.app,
            env: r.env,
            key: r.key,
            value: r.value,
            type: r.type,
            vault_dir: this.vault_dir,
        }))
    }

    async remove_secrets(filters) {
        return this.execute_write_sql('DELETE FROM secrets', filters)
    }

    // ---- Onboarding state (migration v004) ----

    /**
     * Insert (or replace) an onboarding row, keyed by email. Stamps
     * created_at/updated_at. Defaults state to 'invited'.
     * @param {object} fields
     * @param {string} fields.email
     */
    async onboarding_create({
        email,
        username = null,
        name = null,
        slack_handle = null,
        slack_user_id = null,
        project_filter = null,
        fingerprint = null,
        pubkey = null,
        state = 'invited',
    }) {
        const now = Math.floor(Date.now() / 1000)
        return this._with_db((db) => {
            db.run(
                `INSERT OR REPLACE INTO onboarding
                    (email, username, name, slack_handle, slack_user_id,
                     project_filter, fingerprint, pubkey, state,
                     created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    email, username, name, slack_handle, slack_user_id,
                    project_filter, fingerprint, pubkey, state,
                    now, now,
                ]
            )
        }, true)
    }

    async onboarding_get(email) {
        return this._with_db((db) => {
            const rows = this._query_rows(
                db, 'SELECT * FROM onboarding WHERE email = ?', [email]
            )
            return rows.length > 0 ? rows[0] : null
        })
    }

    async onboarding_list(filters = {}) {
        return this.execute_sql(
            ['SELECT * FROM onboarding', ' ORDER BY created_at'],
            filters
        )
    }

    async onboarding_set_state(email, state) {
        const now = Math.floor(Date.now() / 1000)
        return this._with_db((db) => {
            db.run(
                'UPDATE onboarding SET state = ?, updated_at = ? WHERE email = ?',
                [state, now, email]
            )
        }, true)
    }

    /**
     * Update a subset of mutable onboarding columns. Always bumps
     * updated_at. Unknown keys are ignored.
     * @param {string} email
     * @param {object} fields
     */
    async onboarding_update(email, fields) {
        const allowed = [
            'username', 'name', 'slack_handle', 'slack_user_id',
            'project_filter', 'fingerprint', 'pubkey', 'state',
        ]
        const sets = []
        const params = []

        for (const col of allowed) {
            if (col in fields) {
                sets.push(`${col} = ?`)
                params.push(fields[col])
            }
        }
        if (sets.length === 0) return

        sets.push('updated_at = ?')
        params.push(Math.floor(Date.now() / 1000))
        params.push(email)

        return this._with_db((db) => {
            db.run(
                `UPDATE onboarding SET ${sets.join(', ')} WHERE email = ?`,
                params
            )
        }, true)
    }

    async onboarding_delete(email) {
        return this._with_db((db) => {
            db.run('DELETE FROM onboarding WHERE email = ?', [email])
        }, true)
    }
}
