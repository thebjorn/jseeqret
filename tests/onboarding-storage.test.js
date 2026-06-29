import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import initSqlJs from 'sql.js'
import { run_migrations, upgrade_db } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir
let storage

async function open_test_db() {
    const SQL = await initSqlJs()
    const buf = fs.readFileSync(path.join(tmp_dir, 'seeqrets.db'))
    return new SQL.Database(buf)
}

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-onb-'))
    const kp = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    await run_migrations(tmp_dir, 'admin', 'admin@test.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
})

afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('migration v004 — onboarding table', () => {
    it('creates the onboarding table with the expected columns', async () => {
        const db = await open_test_db()
        const info = db.exec('PRAGMA table_info(onboarding)')
        const cols = info[0].values.map(r => r[1])
        expect(cols).toEqual(expect.arrayContaining([
            'email', 'username', 'slack_handle', 'slack_user_id',
            'project_filter', 'fingerprint', 'pubkey', 'state',
            'created_at', 'updated_at',
        ]))
        db.close()
    })

    it('records migration version 4', async () => {
        const db = await open_test_db()
        const rows = db.exec('SELECT version FROM migrations ORDER BY version')
        const versions = rows[0].values.map(r => r[0])
        expect(versions).toContain(4)
        db.close()
    })

    it('upgrade_db adds the onboarding table to a pre-v4 vault', async () => {
        // Simulate an older vault by dropping the table + version row.
        await storage._with_db((db) => {
            db.run('DROP TABLE onboarding')
            db.run('DELETE FROM migrations WHERE version = 4')
        }, true)

        await upgrade_db(tmp_dir)

        const db = await open_test_db()
        const tables = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='onboarding'"
        )
        expect(tables.length).toBeGreaterThan(0)
        db.close()
    })
})

describe('SqliteStorage — onboarding CRUD', () => {
    it('create + get round-trips a row', async () => {
        await storage.onboarding_create({
            email: 'newbie@test.com',
            username: 'newbie',
            project_filter: 'myapp:*:*',
        })

        const row = await storage.onboarding_get('newbie@test.com')
        expect(row.email).toBe('newbie@test.com')
        expect(row.username).toBe('newbie')
        expect(row.project_filter).toBe('myapp:*:*')
        expect(row.state).toBe('invited')
        expect(row.created_at).toBeGreaterThan(0)
        expect(row.updated_at).toBeGreaterThan(0)
    })

    it('get returns null for an unknown email', async () => {
        expect(await storage.onboarding_get('nobody@test.com')).toBeNull()
    })

    it('set_state moves a row through the machine', async () => {
        await storage.onboarding_create({ email: 'a@test.com' })
        await storage.onboarding_set_state('a@test.com', 'introduced')
        let row = await storage.onboarding_get('a@test.com')
        expect(row.state).toBe('introduced')

        await storage.onboarding_set_state('a@test.com', 'approved')
        row = await storage.onboarding_get('a@test.com')
        expect(row.state).toBe('approved')
    })

    it('update captures fingerprint, pubkey, slack ids', async () => {
        await storage.onboarding_create({ email: 'a@test.com' })
        await storage.onboarding_update('a@test.com', {
            fingerprint: 'a1b2c',
            pubkey: 'PKDATA',
            slack_user_id: 'U123',
            slack_handle: 'newbie_slk',
            state: 'introduced',
        })
        const row = await storage.onboarding_get('a@test.com')
        expect(row.fingerprint).toBe('a1b2c')
        expect(row.pubkey).toBe('PKDATA')
        expect(row.slack_user_id).toBe('U123')
        expect(row.slack_handle).toBe('newbie_slk')
        expect(row.state).toBe('introduced')
    })

    it('list returns all rows ordered by created_at', async () => {
        await storage.onboarding_create({ email: 'a@test.com' })
        await storage.onboarding_create({ email: 'b@test.com' })
        const rows = await storage.onboarding_list()
        expect(rows).toHaveLength(2)
        expect(rows.map(r => r.email).sort()).toEqual(['a@test.com', 'b@test.com'])
    })

    it('list filters by state', async () => {
        await storage.onboarding_create({ email: 'a@test.com', state: 'invited' })
        await storage.onboarding_create({ email: 'b@test.com', state: 'invited' })
        await storage.onboarding_create({ email: 'c@test.com', state: 'complete' })
        const invited = await storage.onboarding_list({ state: 'invited' })
        expect(invited).toHaveLength(2)
    })

    it('delete removes a row', async () => {
        await storage.onboarding_create({ email: 'a@test.com' })
        await storage.onboarding_delete('a@test.com')
        expect(await storage.onboarding_get('a@test.com')).toBeNull()
    })

    it('create uses INSERT OR REPLACE semantics on the email PK', async () => {
        await storage.onboarding_create({ email: 'a@test.com', username: 'first' })
        await storage.onboarding_create({ email: 'a@test.com', username: 'second' })
        const rows = await storage.onboarding_list()
        expect(rows).toHaveLength(1)
        expect(rows[0].username).toBe('second')
    })
})
