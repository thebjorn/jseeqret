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
import { getSeeqretDir } from './vault.js'
import { Secret } from './models/secret.js'
import { User } from './models/user.js'
import { globToSql, hasGlobChars } from './filter.js'

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
   * @param {string} [vaultDir] - override vault directory
   */
  constructor(fname = 'seeqrets.db', vaultDir = null) {
    this.fname = fname
    this._vaultDir = vaultDir
  }

  get vaultDir() {
    return this._vaultDir || getSeeqretDir()
  }

  get dbPath() {
    return path.join(this.vaultDir, this.fname)
  }

  /**
   * Open the database, run a callback, and save if modified.
   * @param {function} fn - receives the sql.js Database instance
   * @param {boolean} [write=false] - whether to save changes back to disk
   * @returns {any} return value of fn
   */
  async _withDb(fn, write = false) {
    const SQL = await getSQL()
    let db
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath)
      db = new SQL.Database(fileBuffer)
    } else {
      db = new SQL.Database()
    }
    try {
      const result = fn(db)
      if (write) {
        const data = db.export()
        fs.writeFileSync(this.dbPath, Buffer.from(data))
      }
      return result
    } finally {
      db.close()
    }
  }

  /**
   * Build a WHERE field clause with parameter.
   */
  _whereField(field, value) {
    if (hasGlobChars(value)) {
      return { clause: `${field} LIKE ?`, params: [globToSql(value)] }
    }
    return { clause: `${field} = ?`, params: [value] }
  }

  /**
   * Build an OR clause for comma-separated values.
   */
  _whereFieldOr(field, values) {
    const clauses = []
    const params = []
    for (const v of values) {
      if (v === '*') {
        clauses.push(`${field} = ?`)
        params.push(v)
      } else {
        const { clause, params: p } = this._whereField(field, v)
        clauses.push(clause)
        params.push(...p)
      }
    }
    return { clause: `(${clauses.join(' OR ')})`, params }
  }

  /**
   * Build a full WHERE clause from a filter dict.
   */
  _whereClause(filters) {
    if (!filters || Object.keys(filters).length === 0) {
      return { clause: '', params: [] }
    }

    const clauses = []
    const params = []

    for (const [k, v] of Object.entries(filters)) {
      if (v.includes(',')) {
        const { clause, params: p } = this._whereFieldOr(k, v.split(','))
        clauses.push(clause)
        params.push(...p)
      } else {
        const { clause, params: p } = this._whereField(k, v)
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
  _queryRows(db, sql, params = []) {
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
  async executeSql(sql, filters = {}) {
    return this._withDb((db) => {
      let orderBy = ''
      if (Array.isArray(sql)) {
        ;[sql, orderBy] = sql
      }
      const { clause, params } = this._whereClause(filters)
      const fullSql = sql + clause + orderBy
      return this._queryRows(db, fullSql, params)
    })
  }

  /**
   * Execute a write SQL statement with filters.
   */
  async executeWriteSql(sql, filters = {}) {
    return this._withDb((db) => {
      let orderBy = ''
      if (Array.isArray(sql)) {
        ;[sql, orderBy] = sql
      }
      const { clause, params } = this._whereClause(filters)
      const fullSql = sql + clause + orderBy
      db.run(fullSql, params)
    }, true)
  }

  // ---- User operations ----

  async addUser(user) {
    return this._withDb((db) => {
      db.run(
        'INSERT INTO users (username, email, pubkey) VALUES (?, ?, ?)',
        [user.username, user.email, user.pubkey]
      )
    }, true)
  }

  async fetchUser(username) {
    return this._withDb((db) => {
      const rows = this._queryRows(
        db,
        'SELECT username, email, pubkey FROM users WHERE username = ?',
        [username]
      )
      return rows.length > 0 ? new User(rows[0].username, rows[0].email, rows[0].pubkey) : null
    })
  }

  async fetchUsers(filters = {}) {
    const rows = await this.executeSql(
      ['SELECT username, email, pubkey FROM users', ' ORDER BY username'],
      filters
    )
    return rows.map(r => new User(r.username, r.email, r.pubkey))
  }

  async fetchAdmin() {
    return this._withDb((db) => {
      const rows = this._queryRows(
        db,
        'SELECT username, email, pubkey FROM users WHERE id = 1'
      )
      return rows.length > 0 ? new User(rows[0].username, rows[0].email, rows[0].pubkey) : null
    })
  }

  // ---- Secret operations ----

  async addSecret(secret) {
    return this._withDb((db) => {
      db.run(
        'INSERT INTO secrets (app, env, key, value, type) VALUES (?, ?, ?, ?, ?)',
        [secret.app, secret.env, secret.key, secret.encryptedValue, secret.type]
      )
    }, true)
  }

  async updateSecret(secret) {
    return this._withDb((db) => {
      db.run(
        'UPDATE secrets SET value = ? WHERE app = ? AND env = ? AND key = ?',
        [secret.encryptedValue, secret.app, secret.env, secret.key]
      )
    }, true)
  }

  async fetchSecrets(filters = {}) {
    const rows = await this.executeSql(
      'SELECT app, env, key, value, type FROM secrets',
      filters
    )
    return rows.map(r => new Secret({
      app: r.app,
      env: r.env,
      key: r.key,
      value: r.value,
      type: r.type,
      vaultDir: this.vaultDir,
    }))
  }

  async removeSecrets(filters) {
    return this.executeWriteSql('DELETE FROM secrets', filters)
  }
}
