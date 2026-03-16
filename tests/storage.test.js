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
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
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

describe('SqliteStorage - Users', () => {
    it('fetch_admin returns the owner', async () => {
        const admin = await storage.fetch_admin()
        expect(admin).not.toBeNull()
        expect(admin.username).toBe('testuser')
        expect(admin.email).toBe('test@test.com')
    })

    it('add_user and fetch_user', async () => {
        const user = new User('alice', 'alice@test.com', 'fakepubkey123')
        await storage.add_user(user)
        const fetched = await storage.fetch_user('alice')
        expect(fetched).not.toBeNull()
        expect(fetched.username).toBe('alice')
        expect(fetched.email).toBe('alice@test.com')
    })

    it('fetch_users returns all users', async () => {
        const user = new User('bob', 'bob@test.com', 'fakepubkey456')
        await storage.add_user(user)
        const users = await storage.fetch_users()
        expect(users).toHaveLength(2)
    })

    it('fetch_users with filter', async () => {
        await storage.add_user(new User('alice', 'a@t.com', 'pk1'))
        await storage.add_user(new User('bob', 'b@t.com', 'pk2'))
        const users = await storage.fetch_users({ username: 'alice' })
        expect(users).toHaveLength(1)
        expect(users[0].username).toBe('alice')
    })

    it('fetch_user returns null for unknown user', async () => {
        const user = await storage.fetch_user('nobody')
        expect(user).toBeNull()
    })
})

describe('SqliteStorage - Secrets', () => {
    it('add_secret and fetch_secrets', async () => {
        const secret = new Secret({
            app: 'myapp', env: 'dev', key: 'API_KEY',
            plaintext_value: 'abc123', vault_dir: tmp_dir,
        })
        await storage.add_secret(secret)
        const secrets = await storage.fetch_secrets({ app: 'myapp', env: 'dev', key: 'API_KEY' })
        expect(secrets).toHaveLength(1)
        expect(secrets[0].get_value()).toBe('abc123')
    })

    it('fetch_secrets with glob filter', async () => {
        await storage.add_secret(new Secret({
            app: 'myapp', env: 'dev', key: 'DB_HOST',
            plaintext_value: 'localhost', vault_dir: tmp_dir,
        }))
        await storage.add_secret(new Secret({
            app: 'myapp', env: 'dev', key: 'DB_PASS',
            plaintext_value: 'secret', vault_dir: tmp_dir,
        }))
        await storage.add_secret(new Secret({
            app: 'myapp', env: 'dev', key: 'API_KEY',
            plaintext_value: 'key123', vault_dir: tmp_dir,
        }))

        const db_secrets = await storage.fetch_secrets({ app: 'myapp', env: 'dev', key: 'DB_*' })
        expect(db_secrets).toHaveLength(2)
        const keys = db_secrets.map(s => s.key).sort()
        expect(keys).toEqual(['DB_HOST', 'DB_PASS'])
    })

    it('update_secret changes value', async () => {
        const secret = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'old', vault_dir: tmp_dir,
        })
        await storage.add_secret(secret)

        const [fetched] = await storage.fetch_secrets({ app: 'a', env: 'e', key: 'K' })
        fetched.set_value('new')
        await storage.update_secret(fetched)

        const [updated] = await storage.fetch_secrets({ app: 'a', env: 'e', key: 'K' })
        expect(updated.get_value()).toBe('new')
    })

    it('remove_secrets deletes matching secrets', async () => {
        await storage.add_secret(new Secret({
            app: 'a', env: 'e', key: 'KEEP',
            plaintext_value: 'v1', vault_dir: tmp_dir,
        }))
        await storage.add_secret(new Secret({
            app: 'a', env: 'e', key: 'DELETE_ME',
            plaintext_value: 'v2', vault_dir: tmp_dir,
        }))

        await storage.remove_secrets({ app: 'a', env: 'e', key: 'DELETE_ME' })

        const remaining = await storage.fetch_secrets({ app: 'a', env: 'e', key: '*' })
        expect(remaining).toHaveLength(1)
        expect(remaining[0].key).toBe('KEEP')
    })

    it('respects type conversion for int', async () => {
        await storage.add_secret(new Secret({
            app: 'a', env: 'e', key: 'PORT',
            plaintext_value: '5432', type: 'int', vault_dir: tmp_dir,
        }))

        const [secret] = await storage.fetch_secrets({ app: 'a', env: 'e', key: 'PORT' })
        expect(secret.get_value()).toBe(5432)
        expect(typeof secret.get_value()).toBe('number')
    })

    it('empty result for non-matching filter', async () => {
        const secrets = await storage.fetch_secrets({ app: 'nonexistent', env: '*', key: '*' })
        expect(secrets).toHaveLength(0)
    })
})
