/**
 * Database migrations - compatible with Python seeqret's schema.
 *
 * Uses sql.js (pure JS/WASM SQLite).
 */

import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'

/**
 * Initialize sql.js and open (or create) the database.
 * @param {string} db_path
 * @returns {Promise<{ SQL: any, db: any }>}
 */
async function open_db(db_path) {
    const SQL = await initSqlJs()
    let db

    if (fs.existsSync(db_path)) {
        const buf = fs.readFileSync(db_path)
        db = new SQL.Database(buf)
    } else {
        db = new SQL.Database()
    }

    return { SQL, db }
}

function save_db(db, db_path) {
    const data = db.export()
    fs.writeFileSync(db_path, Buffer.from(data))
}

function table_exists(db, table_name) {
    const rows = db.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${table_name}'`
    )
    return rows.length > 0 && rows[0].values.length > 0
}

function column_exists(db, table_name, column_name) {
    const rows = db.exec(`PRAGMA table_info(${table_name})`)
    if (rows.length === 0) return false
    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    return rows[0].values.some(r => r[1] === column_name)
}

/**
 * Get the current schema version.
 */
export function current_version_sync(db) {
    if (!table_exists(db, 'migrations')) return 0

    const rows = db.exec('SELECT MAX(version) as v FROM migrations')
    if (rows.length === 0 || rows[0].values.length === 0) return 0

    return rows[0].values[0][0] || 0
}

/**
 * Migration 001: Create initial tables.
 */
function init_db_v001(db, username, email, pubkey) {
    db.run(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            version INTEGER NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT(CURRENT_TIMESTAMP)
        );
    `)
    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (1)')

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            pubkey TEXT NOT NULL
        );
    `)
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users (username)')

    db.run(`
        CREATE TABLE IF NOT EXISTS secrets (
            id INTEGER PRIMARY KEY,
            app TEXT NOT NULL,
            env TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            UNIQUE(app, env, key)
        );
    `)
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_key ON secrets (app, env, key)')

    // Insert owner as user id=1
    db.run(
        'INSERT OR IGNORE INTO users (username, email, pubkey) VALUES (?, ?, ?)',
        [username, email, pubkey]
    )
}

/**
 * Migration 002: Add type and updated columns.
 */
function init_db_v002(db) {
    if (!column_exists(db, 'secrets', 'type')) {
        db.run("ALTER TABLE secrets ADD COLUMN type TEXT NOT NULL DEFAULT('str')")
    }

    if (!column_exists(db, 'secrets', 'updated')) {
        db.run("ALTER TABLE secrets ADD COLUMN updated BOOL DEFAULT(false)")
    }

    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (2)')
}

/**
 * Migration 003: Slack exchange — add slack columns to users and create
 * the encrypted kv table used for Slack tokens and channel config.
 *
 * See documentation/completed/slack-exchange/PLAN.md for the full rationale.
 */
function init_db_v003(db) {
    if (!column_exists(db, 'users', 'slack_handle')) {
        db.run('ALTER TABLE users ADD COLUMN slack_handle TEXT')
    }
    if (!column_exists(db, 'users', 'slack_key_fingerprint')) {
        db.run('ALTER TABLE users ADD COLUMN slack_key_fingerprint TEXT')
    }
    if (!column_exists(db, 'users', 'slack_verified_at')) {
        db.run('ALTER TABLE users ADD COLUMN slack_verified_at INTEGER')
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS kv (
            key             TEXT PRIMARY KEY,
            encrypted_value BLOB NOT NULL,
            updated_at      INTEGER NOT NULL
        );
    `)

    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (3)')
}

/**
 * Migration 004: Onboarding state machine.
 *
 * One row per invitee, keyed by email. Captures the introduction
 * fingerprint AND pubkey locally at receive time so the team lead can
 * approve even after Slack's 24h retention drops the introduction blob
 * (see documentation/completed/onboarding/plan.md, Risks: retention vs. approval).
 */
function init_db_v004(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS onboarding (
            email            TEXT PRIMARY KEY,
            username         TEXT,
            slack_handle     TEXT,
            slack_user_id    TEXT,
            project_filter   TEXT,
            fingerprint      TEXT,
            pubkey           TEXT,
            state            TEXT NOT NULL,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );
    `)

    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (4)')
}

/**
 * Migration 005: Display name.
 *
 * `users.username` is the machine identity (`user@host`), so nothing
 * identified the person. `name` carries the human display name: set by
 * the team lead's invite (`onboarding.name`) and copied onto the user
 * row at approval. Nullable, so vaults written by older versions (and
 * the Python tool) stay readable.
 */
function init_db_v005(db) {
    if (!column_exists(db, 'users', 'name')) {
        db.run('ALTER TABLE users ADD COLUMN name TEXT')
    }
    if (!column_exists(db, 'onboarding', 'name')) {
        db.run('ALTER TABLE onboarding ADD COLUMN name TEXT')
    }

    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (5)')
}

/**
 * Migration 006: Secret modification timestamp.
 *
 * `updated_at` (unix seconds, nullable) records when a secret's value
 * last changed. It rides along in exports so an import can tell whose
 * copy of a diverged secret is newer -- advisory input to the merge
 * flow, never an automatic winner-picker (clocks skew, and timestamps
 * alone cannot prove "both changed"). Nullable, so vaults and exports
 * written by older versions of either tool stay readable.
 */
function init_db_v006(db) {
    if (!column_exists(db, 'secrets', 'updated_at')) {
        db.run('ALTER TABLE secrets ADD COLUMN updated_at INTEGER')
    }

    db.run('INSERT OR IGNORE INTO migrations (version) VALUES (6)')
}

/**
 * Run all pending migrations.
 * @param {string} vault_dir
 * @param {string} username
 * @param {string} email
 * @param {string} pubkey
 */
export async function run_migrations(vault_dir, username, email, pubkey) {
    const db_path = path.join(vault_dir, 'seeqrets.db')
    const { db } = await open_db(db_path)

    try {
        const version = current_version_sync(db)

        if (version < 1) {
            init_db_v001(db, username, email, pubkey)
        }

        if (version < 2) {
            init_db_v002(db)
        }

        if (version < 3) {
            init_db_v003(db)
        }

        if (version < 4) {
            init_db_v004(db)
        }

        if (version < 5) {
            init_db_v005(db)
        }

        if (version < 6) {
            init_db_v006(db)
        }

        save_db(db, db_path)
    } finally {
        db.close()
    }
}

/**
 * Upgrade database to the latest version (for existing vaults).
 * @param {string} vault_dir
 */
export async function upgrade_db(vault_dir) {
    const db_path = path.join(vault_dir, 'seeqrets.db')
    const { db } = await open_db(db_path)

    try {
        const version = current_version_sync(db)
        console.log(`Current database version: ${version}`)

        let upgraded = false

        if (version < 2) {
            init_db_v002(db)
            console.log('Upgraded to version 2.')
            upgraded = true
        }

        if (version < 3) {
            init_db_v003(db)
            console.log('Upgraded to version 3.')
            upgraded = true
        }

        if (version < 4) {
            init_db_v004(db)
            console.log('Upgraded to version 4.')
            upgraded = true
        }

        if (version < 5) {
            init_db_v005(db)
            console.log('Upgraded to version 5.')
            upgraded = true
        }

        if (version < 6) {
            init_db_v006(db)
            console.log('Upgraded to version 6.')
            upgraded = true
        }

        if (upgraded) {
            save_db(db, db_path)
        } else {
            console.log('Database is up to date.')
        }
    } finally {
        db.close()
    }
}
