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
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-api-'))
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

    process.env.JSEEQRET = tmp_dir
    close()
})

afterEach(() => {
    close()
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('API: get()', () => {
    it('returns decrypted value', async () => {
        const val = await get('DB_PASS', 'myapp', 'prod')
        expect(val).toBe('s3cret')
    })

    it('returns int type as number', async () => {
        const val = await get('PORT', 'myapp', 'prod')
        expect(val).toBe(5432)
    })

    it('throws on missing secret', async () => {
        await expect(get('NOPE', 'myapp', 'prod')).rejects.toThrow('Secret not found')
    })
})

describe('API: get_sync()', () => {
    it('works after init()', async () => {
        await init()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')
    })

    it('throws if not initialized', () => {
        expect(() => get_sync('DB_PASS', 'myapp', 'prod')).toThrow('not initialized')
    })
})

describe('API: reload()', () => {
    it('picks up changes after reload', async () => {
        await init()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')

        const storage = new SqliteStorage('seeqrets.db', tmp_dir)
        const [secret] = await storage.fetch_secrets({ app: 'myapp', env: 'prod', key: 'DB_PASS' })
        secret.set_value('new-value')
        await storage.update_secret(secret)

        // Still cached
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')

        // After reload
        await reload()
        expect(get_sync('DB_PASS', 'myapp', 'prod')).toBe('new-value')
    })
})
