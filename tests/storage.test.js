import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import { runMigrations } from '../src/core/migrations.js'
import { generateSymmetricKey, generateAndSaveKeyPair } from '../src/core/crypto/utils.js'
import { encodeKey } from '../src/core/crypto/nacl.js'

let tmpDir
let storage

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
  const keyPair = generateAndSaveKeyPair(tmpDir)
  generateSymmetricKey(tmpDir)
  const pubkey = encodeKey(keyPair.publicKey)
  await runMigrations(tmpDir, 'testuser', 'test@test.com', pubkey)
  storage = new SqliteStorage('seeqrets.db', tmpDir)
  process.env.JSEEQRET = tmpDir
})

afterEach(() => {
  delete process.env.JSEEQRET
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('SqliteStorage - Users', () => {
  it('fetchAdmin returns the owner', async () => {
    const admin = await storage.fetchAdmin()
    expect(admin).not.toBeNull()
    expect(admin.username).toBe('testuser')
    expect(admin.email).toBe('test@test.com')
  })

  it('addUser and fetchUser', async () => {
    const user = new User('alice', 'alice@test.com', 'fakepubkey123')
    await storage.addUser(user)
    const fetched = await storage.fetchUser('alice')
    expect(fetched).not.toBeNull()
    expect(fetched.username).toBe('alice')
    expect(fetched.email).toBe('alice@test.com')
  })

  it('fetchUsers returns all users', async () => {
    const user = new User('bob', 'bob@test.com', 'fakepubkey456')
    await storage.addUser(user)
    const users = await storage.fetchUsers()
    expect(users).toHaveLength(2) // testuser + bob
  })

  it('fetchUsers with filter', async () => {
    await storage.addUser(new User('alice', 'a@t.com', 'pk1'))
    await storage.addUser(new User('bob', 'b@t.com', 'pk2'))
    const users = await storage.fetchUsers({ username: 'alice' })
    expect(users).toHaveLength(1)
    expect(users[0].username).toBe('alice')
  })

  it('fetchUser returns null for unknown user', async () => {
    const user = await storage.fetchUser('nobody')
    expect(user).toBeNull()
  })
})

describe('SqliteStorage - Secrets', () => {
  it('addSecret and fetchSecrets', async () => {
    const secret = new Secret({
      app: 'myapp', env: 'dev', key: 'API_KEY',
      plaintextValue: 'abc123', vaultDir: tmpDir,
    })
    await storage.addSecret(secret)
    const secrets = await storage.fetchSecrets({ app: 'myapp', env: 'dev', key: 'API_KEY' })
    expect(secrets).toHaveLength(1)
    expect(secrets[0].getValue()).toBe('abc123')
  })

  it('fetchSecrets with glob filter', async () => {
    await storage.addSecret(new Secret({
      app: 'myapp', env: 'dev', key: 'DB_HOST',
      plaintextValue: 'localhost', vaultDir: tmpDir,
    }))
    await storage.addSecret(new Secret({
      app: 'myapp', env: 'dev', key: 'DB_PASS',
      plaintextValue: 'secret', vaultDir: tmpDir,
    }))
    await storage.addSecret(new Secret({
      app: 'myapp', env: 'dev', key: 'API_KEY',
      plaintextValue: 'key123', vaultDir: tmpDir,
    }))

    const dbSecrets = await storage.fetchSecrets({ app: 'myapp', env: 'dev', key: 'DB_*' })
    expect(dbSecrets).toHaveLength(2)
    const keys = dbSecrets.map(s => s.key).sort()
    expect(keys).toEqual(['DB_HOST', 'DB_PASS'])
  })

  it('updateSecret changes value', async () => {
    const secret = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'old', vaultDir: tmpDir,
    })
    await storage.addSecret(secret)

    const [fetched] = await storage.fetchSecrets({ app: 'a', env: 'e', key: 'K' })
    fetched.setValue('new')
    await storage.updateSecret(fetched)

    const [updated] = await storage.fetchSecrets({ app: 'a', env: 'e', key: 'K' })
    expect(updated.getValue()).toBe('new')
  })

  it('removeSecrets deletes matching secrets', async () => {
    await storage.addSecret(new Secret({
      app: 'a', env: 'e', key: 'KEEP',
      plaintextValue: 'v1', vaultDir: tmpDir,
    }))
    await storage.addSecret(new Secret({
      app: 'a', env: 'e', key: 'DELETE_ME',
      plaintextValue: 'v2', vaultDir: tmpDir,
    }))

    await storage.removeSecrets({ app: 'a', env: 'e', key: 'DELETE_ME' })

    const remaining = await storage.fetchSecrets({ app: 'a', env: 'e', key: '*' })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].key).toBe('KEEP')
  })

  it('respects type conversion for int', async () => {
    await storage.addSecret(new Secret({
      app: 'a', env: 'e', key: 'PORT',
      plaintextValue: '5432', type: 'int', vaultDir: tmpDir,
    }))

    const [secret] = await storage.fetchSecrets({ app: 'a', env: 'e', key: 'PORT' })
    expect(secret.getValue()).toBe(5432)
    expect(typeof secret.getValue()).toBe('number')
  })

  it('empty result for non-matching filter', async () => {
    const secrets = await storage.fetchSecrets({ app: 'nonexistent', env: '*', key: '*' })
    expect(secrets).toHaveLength(0)
  })
})
