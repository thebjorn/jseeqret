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

        if (version < 2) {
            init_db_v002(db)
            save_db(db, db_path)
            console.log('Upgraded to version 2.')
        } else {
            console.log('Database is up to date.')
        }
    } finally {
        db.close()
    }
}
