import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { get, getSync, init, close, reload } from '../src/core/api.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { runMigrations } from '../src/core/migrations.js'
import { generateSymmetricKey, generateAndSaveKeyPair } from '../src/core/crypto/utils.js'
import { encodeKey } from '../src/core/crypto/nacl.js'

let tmpDir

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-api-'))
  const keyPair = generateAndSaveKeyPair(tmpDir)
  generateSymmetricKey(tmpDir)
  await runMigrations(tmpDir, 'testuser', 'test@test.com', encodeKey(keyPair.publicKey))

  const storage = new SqliteStorage('seeqrets.db', tmpDir)
  await storage.addSecret(new Secret({
    app: 'myapp', env: 'prod', key: 'DB_PASS',
    plaintextValue: 's3cret', vaultDir: tmpDir,
  }))
  await storage.addSecret(new Secret({
    app: 'myapp', env: 'prod', key: 'PORT',
    plaintextValue: '5432', type: 'int', vaultDir: tmpDir,
  }))

  process.env.JSEEQRET = tmpDir
  close() // ensure fresh cache
})

afterEach(() => {
  close()
  delete process.env.JSEEQRET
  fs.rmSync(tmpDir, { recursive: true, force: true })
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

describe('API: getSync()', () => {
  it('works after init()', async () => {
    await init()
    expect(getSync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')
  })

  it('throws if not initialized', () => {
    expect(() => getSync('DB_PASS', 'myapp', 'prod')).toThrow('not initialized')
  })
})

describe('API: reload()', () => {
  it('picks up changes after reload', async () => {
    await init()
    expect(getSync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')

    // Write a new value via storage
    const storage = new SqliteStorage('seeqrets.db', tmpDir)
    const [secret] = await storage.fetchSecrets({ app: 'myapp', env: 'prod', key: 'DB_PASS' })
    secret.setValue('new-value')
    await storage.updateSecret(secret)

    // Still cached
    expect(getSync('DB_PASS', 'myapp', 'prod')).toBe('s3cret')

    // After reload
    await reload()
    expect(getSync('DB_PASS', 'myapp', 'prod')).toBe('new-value')
  })
})
