import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { get, get_sync, init, close, reload } from '../src/core/api.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { run_migrations } from '../src/core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-api-extra-'))
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    await run_migrations(tmp_dir, 'testuser', 'test@test.com', encode_key(key_pair.publicKey))

    const storage = new SqliteStorage('seeqrets.db', tmp_dir)
    await storage.add_secret(new Secret({
        app: 'myapp', env: 'prod', key: 'DB_PASS',
        plaintext_value: 's3cret', vault_dir: tmp_dir,
    }))
    await storage.add_secret(new Secret({
        app: 'myapp', env: 'prod', key: 'PORT',
        plaintext_value: '5432', type: 'int', vault_dir: tmp_dir,
    }))
    await storage.add_secret(new Secret({
        app: 'myapp', env: 'dev', key: 'DB_PASS',
        plaintext_value: 'devpass', vault_dir: tmp_dir,
    }))
    await storage.add_secret(new Secret({
        app: 'myapp', env: 'prod', key: 'UNICODE_VAL',
        plaintext_value: 'café ☕', vault_dir: tmp_dir,
    }))

    process.env.JSEEQRET = tmp_dir
    close()
})

afterEach(() => {
    close()
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('API: get() additional cases', () => {
    it('distinguishes same key in different envs', async () => {
        const prod = await get('DB_PASS', 'myapp', 'prod')
        const dev = await get('DB_PASS', 'myapp', 'dev')
        expect(prod).toBe('s3cret')
        expect(dev).toBe('devpass')
    })

    it('returns unicode value correctly', async () => {
        const val = await get('UNICODE_VAL', 'myapp', 'prod')
        expect(val).toBe('café ☕')
    })

    it('caches after first call (no error on second call)', async () => {
        const v1 = await get('DB_PASS', 'myapp', 'prod')
        const v2 = await get('PORT', 'myapp', 'prod')
        expect(v1).toBe('s3cret')
        expect(v2).toBe(5432)
    })
})

describe('API: init() and close()', () => {
    it('close() can be called multiple times safely', () => {
        expect(() => {
            close()
            close()
            close()
        }).not.toThrow()
    })

    it('init() then close() then init() works', async () => {
        await init()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')
        close()
        expect(() => get_sync('DB_PASS', 'myapp', 'prod')).toThrow('not initialized')
        await init()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')
    })
})

describe('API: get_sync() additional cases', () => {
    it('returns int type correctly', async () => {
        await init()
        const val = get_sync('PORT', 'myapp', 'prod')
        expect(val).toBe(5432)
        expect(typeof val).toBe('number')
    })

    it('throws descriptive error for missing secret', async () => {
        await init()
        expect(() => get_sync('MISSING', 'myapp', 'prod')).toThrow('Secret not found: myapp:prod:MISSING')
    })
})

describe('API: vault dir change detection', () => {
    it('picks up vault dir change via env var', async () => {
        await init()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')

        // Create a second vault
        const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-api-extra2-'))
        const kp2 = generate_and_save_key_pair(tmp2)
        generate_symmetric_key(tmp2)
        await run_migrations(tmp2, 'user2', 'u2@test.com', encode_key(kp2.publicKey))
        const storage2 = new SqliteStorage('seeqrets.db', tmp2)
        await storage2.add_secret(new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'other-secret', vault_dir: tmp2,
        }))

        close()
        process.env.JSEEQRET = tmp2

        const val = await get('DB_PASS', 'myapp', 'prod')
        expect(val).toBe('other-secret')

        close()
        process.env.JSEEQRET = tmp_dir
        fs.rmSync(tmp2, { recursive: true, force: true })
    })
})
