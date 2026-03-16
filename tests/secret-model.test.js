import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Secret } from '../src/core/models/secret.js'
import { generate_symmetric_key } from '../src/core/crypto/utils.js'

let tmp_dir

beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-secret-'))
    generate_symmetric_key(tmp_dir)
    process.env.JSEEQRET = tmp_dir
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('Secret model', () => {
    it('encrypts on construction with plaintext_value', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'hello', vault_dir: tmp_dir,
        })
        expect(s.encrypted_value).not.toBe('hello')
        expect(typeof s.encrypted_value).toBe('string')
    })

    it('get_value decrypts correctly', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'secret123', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe('secret123')
    })

    it('set_value re-encrypts', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'old', vault_dir: tmp_dir,
        })
        const old_token = s.encrypted_value
        s.set_value('new')
        expect(s.encrypted_value).not.toBe(old_token)
        expect(s.get_value()).toBe('new')
    })

    it('to_plaintext_dict includes decrypted value', () => {
        const s = new Secret({
            app: 'myapp', env: 'prod', key: 'KEY',
            plaintext_value: 'val', type: 'str', vault_dir: tmp_dir,
        })
        expect(s.to_plaintext_dict()).toEqual({
            app: 'myapp', env: 'prod', key: 'KEY',
            type: 'str', value: 'val',
        })
    })

    it('toJSON includes encrypted value', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'v', vault_dir: tmp_dir,
        })
        const json = s.toJSON()
        expect(json.value).toBe(s.encrypted_value)
        expect(json.value).not.toBe('v')
    })

    it('row returns [app, env, key, value, type]', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'val', type: 'str', vault_dir: tmp_dir,
        })
        expect(s.row).toEqual(['a', 'e', 'K', 'val', 'str'])
    })

    it('type conversion: int', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'PORT',
            plaintext_value: '8080', type: 'int', vault_dir: tmp_dir,
        })
        expect(s.get_value()).toBe(8080)
    })

    it('fingerprint returns 5-char hex string', () => {
        const s = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'v', vault_dir: tmp_dir,
        })
        const fp = s.fingerprint()
        expect(fp).toHaveLength(5)
        expect(fp).toMatch(/^[0-9a-f]+$/)
    })

    it('throws if neither value nor plaintext_value provided', () => {
        expect(() => new Secret({ app: 'a', env: 'e', key: 'K' })).toThrow()
    })
})
