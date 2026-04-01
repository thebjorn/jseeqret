import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import { run_migrations } from '../src/core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir
let storage

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-storage-extra-'))
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    const pubkey = encode_key(key_pair.publicKey)
    await run_migrations(tmp_dir, 'testuser', 'test@test.com', pubkey)
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
    process.env.JSEEQRET = tmp_dir
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('SqliteStorage - execute_sql with ORDER BY', () => {
    it('supports sql as array [query, order_by]', async () => {
        await storage.add_secret(new Secret({ app: 'b', env: 'e', key: 'K1', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'K2', plaintext_value: 'v2', vault_dir: tmp_dir }))

        const rows = await storage.execute_sql(
            ['SELECT app, env, key, value, type FROM secrets', ' ORDER BY app'],
            {}
        )
        expect(rows).toHaveLength(2)
        expect(rows[0].app).toBe('a')
        expect(rows[1].app).toBe('b')
    })
})

describe('SqliteStorage - comma-separated filter values', () => {
    it('handles comma-separated env values', async () => {
        await storage.add_secret(new Secret({ app: 'a', env: 'dev', key: 'K', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'a', env: 'prod', key: 'K', plaintext_value: 'v2', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'a', env: 'staging', key: 'K', plaintext_value: 'v3', vault_dir: tmp_dir }))

        const secrets = await storage.fetch_secrets({ app: 'a', env: 'dev,prod', key: 'K' })
        expect(secrets).toHaveLength(2)
        const envs = secrets.map(s => s.env).sort()
        expect(envs).toEqual(['dev', 'prod'])
    })
})

describe('SqliteStorage - wildcard filters', () => {
    it('* matches all values', async () => {
        await storage.add_secret(new Secret({ app: 'app1', env: 'dev', key: 'K1', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'app2', env: 'prod', key: 'K2', plaintext_value: 'v2', vault_dir: tmp_dir }))

        const secrets = await storage.fetch_secrets({ app: '*', env: '*', key: '*' })
        expect(secrets).toHaveLength(2)
    })

    it('? matches single character', async () => {
        await storage.add_secret(new Secret({ app: 'app1', env: 'dev', key: 'K', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'app2', env: 'dev', key: 'K', plaintext_value: 'v2', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'app10', env: 'dev', key: 'K', plaintext_value: 'v3', vault_dir: tmp_dir }))

        const secrets = await storage.fetch_secrets({ app: 'app?', env: 'dev', key: 'K' })
        expect(secrets).toHaveLength(2)
        const apps = secrets.map(s => s.app).sort()
        expect(apps).toEqual(['app1', 'app2'])
    })
})

describe('SqliteStorage - multiple secrets operations', () => {
    it('add_secret fails on duplicate key', async () => {
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'K', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await expect(
            storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'K', plaintext_value: 'v2', vault_dir: tmp_dir }))
        ).rejects.toThrow()
    })

    it('remove_secrets with glob pattern', async () => {
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'DB_HOST', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'DB_PASS', plaintext_value: 'v2', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'API_KEY', plaintext_value: 'v3', vault_dir: tmp_dir }))

        await storage.remove_secrets({ app: 'a', env: 'e', key: 'DB_*' })
        const remaining = await storage.fetch_secrets({ app: 'a', env: 'e', key: '*' })
        expect(remaining).toHaveLength(1)
        expect(remaining[0].key).toBe('API_KEY')
    })

    it('fetch_secrets with no filters returns all', async () => {
        await storage.add_secret(new Secret({ app: 'a', env: 'e', key: 'K1', plaintext_value: 'v1', vault_dir: tmp_dir }))
        await storage.add_secret(new Secret({ app: 'b', env: 'f', key: 'K2', plaintext_value: 'v2', vault_dir: tmp_dir }))

        const secrets = await storage.fetch_secrets()
        expect(secrets).toHaveLength(2)
    })
})

describe('SqliteStorage - user operations extra', () => {
    it('fetch_users with glob filter on username', async () => {
        await storage.add_user(new User('alice', 'a@t.com', 'pk1'))
        await storage.add_user(new User('alex', 'ax@t.com', 'pk2'))
        await storage.add_user(new User('bob', 'b@t.com', 'pk3'))

        const users = await storage.fetch_users({ username: 'al*' })
        expect(users).toHaveLength(2)
    })

    it('add_user with duplicate username fails', async () => {
        await storage.add_user(new User('alice', 'a@t.com', 'pk1'))
        await expect(
            storage.add_user(new User('alice', 'other@t.com', 'pk2'))
        ).rejects.toThrow()
    })
})

describe('SqliteStorage - db_path and vault_dir', () => {
    it('db_path joins vault_dir and fname', () => {
        expect(storage.db_path).toBe(path.join(tmp_dir, 'seeqrets.db'))
    })

    it('vault_dir uses provided value', () => {
        expect(storage.vault_dir).toBe(tmp_dir)
    })

    it('custom fname is used in db_path', () => {
        const custom = new SqliteStorage('custom.db', tmp_dir)
        expect(custom.db_path).toBe(path.join(tmp_dir, 'custom.db'))
    })
})
