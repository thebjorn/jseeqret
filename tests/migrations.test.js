import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import initSqlJs from 'sql.js'
import { runMigrations } from '../src/core/migrations.js'
import { generateSymmetricKey, generateAndSaveKeyPair } from '../src/core/crypto/utils.js'
import { encodeKey } from '../src/core/crypto/nacl.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-mig-'))
  generateSymmetricKey(tmpDir)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function openTestDb() {
  const SQL = await initSqlJs()
  const dbPath = path.join(tmpDir, 'seeqrets.db')
  const buf = fs.readFileSync(dbPath)
  return new SQL.Database(buf)
}

describe('migrations', () => {
  it('creates all tables', async () => {
    const kp = generateAndSaveKeyPair(tmpDir)
    await runMigrations(tmpDir, 'admin', 'admin@test.com', encodeKey(kp.publicKey))

    const db = await openTestDb()
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    const tableNames = tables[0].values.map(r => r[0])
    expect(tableNames).toContain('migrations')
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('secrets')
    db.close()
  })

  it('inserts owner as user id=1', async () => {
    const kp = generateAndSaveKeyPair(tmpDir)
    const pubkey = encodeKey(kp.publicKey)
    await runMigrations(tmpDir, 'admin', 'admin@test.com', pubkey)

    const db = await openTestDb()
    const rows = db.exec('SELECT id, username, email FROM users WHERE id = 1')
    expect(rows[0].values[0][1]).toBe('admin')
    expect(rows[0].values[0][2]).toBe('admin@test.com')
    db.close()
  })

  it('migration v2 adds type and updated columns', async () => {
    const kp = generateAndSaveKeyPair(tmpDir)
    await runMigrations(tmpDir, 'admin', 'a@b.com', encodeKey(kp.publicKey))

    const db = await openTestDb()
    const info = db.exec('PRAGMA table_info(secrets)')
    const colNames = info[0].values.map(r => r[1])
    expect(colNames).toContain('type')
    expect(colNames).toContain('updated')
    db.close()
  })

  it('records migration versions', async () => {
    const kp = generateAndSaveKeyPair(tmpDir)
    await runMigrations(tmpDir, 'admin', 'a@b.com', encodeKey(kp.publicKey))

    const db = await openTestDb()
    const rows = db.exec('SELECT version FROM migrations ORDER BY version')
    const versions = rows[0].values.map(r => r[0])
    expect(versions).toContain(1)
    expect(versions).toContain(2)
    db.close()
  })

  it('is idempotent (can run twice)', async () => {
    const kp = generateAndSaveKeyPair(tmpDir)
    const pubkey = encodeKey(kp.publicKey)
    await runMigrations(tmpDir, 'admin', 'a@b.com', pubkey)
    await runMigrations(tmpDir, 'admin', 'a@b.com', pubkey)

    const db = await openTestDb()
    const rows = db.exec('SELECT COUNT(*) FROM users')
    expect(rows[0].values[0][0]).toBe(1) // still just 1 user
    db.close()
  })
})
