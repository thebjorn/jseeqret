import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { run_migrations, upgrade_db, current_version_sync } from '../src/core/migrations.js'
import { generate_and_save_key_pair, generate_symmetric_key } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import initSqlJs from 'sql.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-mig-extra-'))
    generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('migrations - idempotency', () => {
    it('running migrations twice is safe', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        const pub = encode_key(kp.publicKey)
        await run_migrations(tmp_dir, 'user1', 'u@t.com', pub)
        await run_migrations(tmp_dir, 'user1', 'u@t.com', pub)

        const SQL = await initSqlJs()
        const buf = fs.readFileSync(path.join(tmp_dir, 'seeqrets.db'))
        const db = new SQL.Database(buf)
        const version = current_version_sync(db)
        expect(version).toBe(2)
        db.close()
    })
})

describe('upgrade_db', () => {
    it('upgrades from v1 to v2', async () => {
        // Create a v1-only database manually
        const SQL = await initSqlJs()
        const db = new SQL.Database()

        db.run(`CREATE TABLE migrations (
            id INTEGER PRIMARY KEY,
            version INTEGER NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT(CURRENT_TIMESTAMP)
        )`)
        db.run('INSERT INTO migrations (version) VALUES (1)')
        db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            email TEXT NOT NULL,
            pubkey TEXT NOT NULL
        )`)
        db.run('CREATE UNIQUE INDEX idx_users_username ON users (username)')
        db.run(`CREATE TABLE secrets (
            id INTEGER PRIMARY KEY,
            app TEXT NOT NULL,
            env TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            UNIQUE(app, env, key)
        )`)
        db.run("INSERT INTO users (username, email, pubkey) VALUES ('owner', 'o@t.com', 'pk')")

        const data = db.export()
        fs.writeFileSync(path.join(tmp_dir, 'seeqrets.db'), Buffer.from(data))
        db.close()

        // Verify it's v1
        const SQL2 = await initSqlJs()
        const buf1 = fs.readFileSync(path.join(tmp_dir, 'seeqrets.db'))
        const db1 = new SQL2.Database(buf1)
        expect(current_version_sync(db1)).toBe(1)
        db1.close()

        // Upgrade
        await upgrade_db(tmp_dir)

        // Verify it's v2
        const buf2 = fs.readFileSync(path.join(tmp_dir, 'seeqrets.db'))
        const db2 = new SQL2.Database(buf2)
        expect(current_version_sync(db2)).toBe(2)

        // Check new columns exist
        const info = db2.exec('PRAGMA table_info(secrets)')
        const cols = info[0].values.map(r => r[1])
        expect(cols).toContain('type')
        expect(cols).toContain('updated')
        db2.close()
    })

    it('is a no-op when already at latest version', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'user1', 'u@t.com', encode_key(kp.publicKey))

        // Should not throw
        await upgrade_db(tmp_dir)

        const SQL = await initSqlJs()
        const buf = fs.readFileSync(path.join(tmp_dir, 'seeqrets.db'))
        const db = new SQL.Database(buf)
        expect(current_version_sync(db)).toBe(2)
        db.close()
    })
})

describe('current_version_sync', () => {
    it('returns 0 for empty database', async () => {
        const SQL = await initSqlJs()
        const db = new SQL.Database()
        expect(current_version_sync(db)).toBe(0)
        db.close()
    })

    it('returns 0 for empty migrations table', async () => {
        const SQL = await initSqlJs()
        const db = new SQL.Database()
        db.run(`CREATE TABLE migrations (
            id INTEGER PRIMARY KEY,
            version INTEGER NOT NULL,
            applied_at DATETIME NOT NULL DEFAULT(CURRENT_TIMESTAMP)
        )`)
        expect(current_version_sync(db)).toBe(0)
        db.close()
    })
})
