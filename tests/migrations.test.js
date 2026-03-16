import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import initSqlJs from 'sql.js'
import { run_migrations } from '../src/core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-mig-'))
    generate_symmetric_key(tmp_dir)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

async function open_test_db() {
    const SQL = await initSqlJs()
    const db_path = path.join(tmp_dir, 'seeqrets.db')
    const buf = fs.readFileSync(db_path)
    return new SQL.Database(buf)
}

describe('migrations', () => {
    it('creates all tables', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'admin@test.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const tables = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        const table_names = tables[0].values.map(r => r[0])
        expect(table_names).toContain('migrations')
        expect(table_names).toContain('users')
        expect(table_names).toContain('secrets')
        db.close()
    })

    it('inserts owner as user id=1', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        const pubkey = encode_key(kp.publicKey)
        await run_migrations(tmp_dir, 'admin', 'admin@test.com', pubkey)

        const db = await open_test_db()
        const rows = db.exec('SELECT id, username, email FROM users WHERE id = 1')
        expect(rows[0].values[0][1]).toBe('admin')
        expect(rows[0].values[0][2]).toBe('admin@test.com')
        db.close()
    })

    it('migration v2 adds type and updated columns', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const info = db.exec('PRAGMA table_info(secrets)')
        const col_names = info[0].values.map(r => r[1])
        expect(col_names).toContain('type')
        expect(col_names).toContain('updated')
        db.close()
    })

    it('records migration versions', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const rows = db.exec('SELECT version FROM migrations ORDER BY version')
        const versions = rows[0].values.map(r => r[0])
        expect(versions).toContain(1)
        expect(versions).toContain(2)
        db.close()
    })

    it('is idempotent (can run twice)', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        const pubkey = encode_key(kp.publicKey)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', pubkey)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', pubkey)

        const db = await open_test_db()
        const rows = db.exec('SELECT COUNT(*) FROM users')
        expect(rows[0].values[0][0]).toBe(1)
        db.close()
    })
})
