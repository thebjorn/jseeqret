import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import initSqlJs from 'sql.js'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-slkmig-'))
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

describe('migration v003 slack-exchange', () => {
    it('creates the kv table', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const tables = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='kv'"
        )
        expect(tables.length).toBe(1)
        db.close()
    })

    it('adds slack columns to users', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const info = db.exec('PRAGMA table_info(users)')
        const col_names = info[0].values.map(r => r[1])
        expect(col_names).toContain('slack_handle')
        expect(col_names).toContain('slack_key_fingerprint')
        expect(col_names).toContain('slack_verified_at')
        db.close()
    })

    it('records version 3', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const db = await open_test_db()
        const rows = db.exec('SELECT version FROM migrations ORDER BY version')
        const versions = rows[0].values.map(r => r[0])
        expect(versions).toContain(3)
        db.close()
    })

    it('kv helpers round-trip raw bytes', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const storage = new SqliteStorage('seeqrets.db', tmp_dir)

        await storage.kv_set('foo', Buffer.from('bar'))
        const got = await storage.kv_get('foo')
        expect(got).not.toBeNull()
        expect(got.toString('utf-8')).toBe('bar')

        await storage.kv_set('foo', Buffer.from('baz'))
        expect((await storage.kv_get('foo')).toString('utf-8')).toBe('baz')

        await storage.kv_delete('foo')
        expect(await storage.kv_get('foo')).toBeNull()
    })

    it('kv_delete_prefix only deletes the matching prefix', async () => {
        const kp = generate_and_save_key_pair(tmp_dir)
        await run_migrations(tmp_dir, 'admin', 'a@b.com', encode_key(kp.publicKey))

        const storage = new SqliteStorage('seeqrets.db', tmp_dir)
        await storage.kv_set('slack.a', Buffer.from('1'))
        await storage.kv_set('slack.b', Buffer.from('2'))
        await storage.kv_set('other.c', Buffer.from('3'))

        await storage.kv_delete_prefix('slack.')

        expect(await storage.kv_get('slack.a')).toBeNull()
        expect(await storage.kv_get('slack.b')).toBeNull()
        expect((await storage.kv_get('other.c')).toString('utf-8')).toBe('3')
    })
})
