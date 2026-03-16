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
 * @param {string} dbPath
 * @returns {Promise<{ SQL: any, db: any }>}
 */
async function openDb(dbPath) {
  const SQL = await initSqlJs()
  let db
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    db = new SQL.Database(buf)
  } else {
    db = new SQL.Database()
  }
  return { SQL, db }
}

function saveDb(db, dbPath) {
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

function tableExists(db, tableName) {
  const rows = db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
  )
  return rows.length > 0 && rows[0].values.length > 0
}

function columnExists(db, tableName, columnName) {
  const rows = db.exec(`PRAGMA table_info(${tableName})`)
  if (rows.length === 0) return false
  // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
  return rows[0].values.some(r => r[1] === columnName)
}

/**
 * Get the current schema version.
 */
export function currentVersionSync(db) {
  if (!tableExists(db, 'migrations')) return 0
  const rows = db.exec('SELECT MAX(version) as v FROM migrations')
  if (rows.length === 0 || rows[0].values.length === 0) return 0
  return rows[0].values[0][0] || 0
}

/**
 * Migration 001: Create initial tables.
 */
function initDbV001(db, username, email, pubkey) {
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
function initDbV002(db) {
  if (!columnExists(db, 'secrets', 'type')) {
    db.run("ALTER TABLE secrets ADD COLUMN type TEXT NOT NULL DEFAULT('str')")
  }
  if (!columnExists(db, 'secrets', 'updated')) {
    db.run("ALTER TABLE secrets ADD COLUMN updated BOOL DEFAULT(false)")
  }
  db.run('INSERT OR IGNORE INTO migrations (version) VALUES (2)')
}

/**
 * Run all pending migrations.
 * @param {string} vaultDir
 * @param {string} username
 * @param {string} email
 * @param {string} pubkey
 */
export async function runMigrations(vaultDir, username, email, pubkey) {
  const dbPath = path.join(vaultDir, 'seeqrets.db')
  const { db } = await openDb(dbPath)
  try {
    const version = currentVersionSync(db)
    if (version < 1) {
      initDbV001(db, username, email, pubkey)
    }
    if (version < 2) {
      initDbV002(db)
    }
    saveDb(db, dbPath)
  } finally {
    db.close()
  }
}

/**
 * Upgrade database to the latest version (for existing vaults).
 * @param {string} vaultDir
 */
export async function upgradeDb(vaultDir) {
  const dbPath = path.join(vaultDir, 'seeqrets.db')
  const { db } = await openDb(dbPath)
  try {
    const version = currentVersionSync(db)
    console.log(`Current database version: ${version}`)
    if (version < 2) {
      initDbV002(db)
      saveDb(db, dbPath)
      console.log('Upgraded to version 2.')
    } else {
      console.log('Database is up to date.')
    }
  } finally {
    db.close()
  }
}
