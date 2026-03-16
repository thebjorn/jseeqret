import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Secret } from '../src/core/models/secret.js'
import { generateSymmetricKey } from '../src/core/crypto/utils.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-secret-'))
  generateSymmetricKey(tmpDir)
  process.env.JSEEQRET = tmpDir
})

afterEach(() => {
  delete process.env.JSEEQRET
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('Secret model', () => {
  it('encrypts on construction with plaintextValue', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'hello', vaultDir: tmpDir,
    })
    // _value should be an encrypted token, not plaintext
    expect(s.encryptedValue).not.toBe('hello')
    expect(typeof s.encryptedValue).toBe('string')
  })

  it('getValue decrypts correctly', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'secret123', vaultDir: tmpDir,
    })
    expect(s.getValue()).toBe('secret123')
  })

  it('setValue re-encrypts', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'old', vaultDir: tmpDir,
    })
    const oldToken = s.encryptedValue
    s.setValue('new')
    expect(s.encryptedValue).not.toBe(oldToken)
    expect(s.getValue()).toBe('new')
  })

  it('toPlaintextDict includes decrypted value', () => {
    const s = new Secret({
      app: 'myapp', env: 'prod', key: 'KEY',
      plaintextValue: 'val', type: 'str', vaultDir: tmpDir,
    })
    expect(s.toPlaintextDict()).toEqual({
      app: 'myapp', env: 'prod', key: 'KEY',
      type: 'str', value: 'val',
    })
  })

  it('toJSON includes encrypted value', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'v', vaultDir: tmpDir,
    })
    const json = s.toJSON()
    expect(json.value).toBe(s.encryptedValue)
    expect(json.value).not.toBe('v')
  })

  it('row returns [app, env, key, value, type]', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'val', type: 'str', vaultDir: tmpDir,
    })
    expect(s.row).toEqual(['a', 'e', 'K', 'val', 'str'])
  })

  it('type conversion: int', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'PORT',
      plaintextValue: '8080', type: 'int', vaultDir: tmpDir,
    })
    expect(s.getValue()).toBe(8080)
  })

  it('fingerprint returns 5-char hex string', () => {
    const s = new Secret({
      app: 'a', env: 'e', key: 'K',
      plaintextValue: 'v', vaultDir: tmpDir,
    })
    const fp = s.fingerprint()
    expect(fp).toHaveLength(5)
    expect(fp).toMatch(/^[0-9a-f]+$/)
  })

  it('throws if neither value nor plaintextValue provided', () => {
    expect(() => new Secret({ app: 'a', env: 'e', key: 'K' })).toThrow()
  })
})
