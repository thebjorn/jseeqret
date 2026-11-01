import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    get, get_sync, init, close, parse_reference,
    SecretNotFound, AmbiguousSecret,
} from '../src/core/api.js'
import * as core from '../src/core/index.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { run_migrations } from '../src/core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'

let tmp_dir

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-api-ref-'))
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    await run_migrations(tmp_dir, 'testuser', 'test@test.com', encode_key(key_pair.publicKey))

    const storage = new SqliteStorage('seeqrets.db', tmp_dir)
    const fixtures = [
        ['yerbu', 'prod', 'CRON_SECRET', 'prod-value'],
        ['yerbu', 'dev', 'CRON_SECRET', 'dev-value'],
        ['yerbu', 'prod', 'ONLY_PROD', 'only-prod-value'],
        ['*', '*', 'GLOBAL', 'global-value'],
    ]
    for (const [app, env, key, value] of fixtures) {
        await storage.add_secret(new Secret({
            app, env, key, plaintext_value: value, vault_dir: tmp_dir,
        }))
    }

    process.env.JSEEQRET = tmp_dir
    close()
})

afterEach(() => {
    close()
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('parse_reference()', () => {
    it.each([
        ['CRON_SECRET', '*', '*', ['CRON_SECRET', '*', '*']],
        ['CRON_SECRET', 'yerbu', 'prod', ['CRON_SECRET', 'yerbu', 'prod']],
        ['yerbu:prod:CRON_SECRET', '*', '*', ['CRON_SECRET', 'yerbu', 'prod']],
        ['::CRON_SECRET', '*', '*', ['CRON_SECRET', '*', '*']],
        [':prod:CRON_SECRET', '*', '*', ['CRON_SECRET', '*', 'prod']],
    ])('parses %s (app=%s, env=%s)', (ref, app, env, expected) => {
        expect(parse_reference(ref, app, env)).toEqual(expected)
    })

    it.each([
        ['yerbu:prod', '*', '*'],                   // no key part
        ['yerbu:prod:', '*', '*'],                  // empty key part
        ['a:b:c:d', '*', '*'],                      // too many parts
        ['yerbu:prod:CRON_SECRET', 'yerbu', '*'],   // app given twice
        ['yerbu:prod:CRON_SECRET', '*', 'prod'],    // env given twice
    ])('rejects %s (app=%s, env=%s)', (ref, app, env) => {
        expect(() => parse_reference(ref, app, env)).toThrow()
    })
})

describe('get() with references and wildcards', () => {
    it('accepts an app:env:key reference', async () => {
        expect(await get('yerbu:prod:CRON_SECRET')).toBe('prod-value')
        expect(await get('yerbu:dev:CRON_SECRET')).toBe('dev-value')
    })

    it('treats * as a wildcard, matching Python seeqret', async () => {
        expect(await get('ONLY_PROD')).toBe('only-prod-value')
        expect(await get('::ONLY_PROD')).toBe('only-prod-value')
        expect(await get(':prod:ONLY_PROD')).toBe('only-prod-value')
    })

    it('still finds secrets stored under *:*', async () => {
        expect(await get('GLOBAL')).toBe('global-value')
    })

    it('rejects a malformed reference before loading the vault', async () => {
        delete process.env.JSEEQRET
        await expect(get('yerbu:prod')).rejects.toThrow('Invalid secret reference')
    })

    it('throws SecretNotFound naming the lookup and the vault', async () => {
        const err = await get('yerbu:test:CRON_SECRET').catch(e => e)
        expect(err).toBeInstanceOf(SecretNotFound)
        expect(err.name).toBe('SecretNotFound')
        expect(err.message).toContain('No secret yerbu:test:CRON_SECRET')
        expect(err.message).toContain(path.join(tmp_dir, 'seeqrets.db'))
        expect(err.message).toContain('jseeqret list -f "*:*:CRON_SECRET"')
    })

    it('throws AmbiguousSecret listing matches but never values', async () => {
        const err = await get('::CRON_SECRET').catch(e => e)
        expect(err).toBeInstanceOf(AmbiguousSecret)
        expect(err.name).toBe('AmbiguousSecret')
        expect(err.matches).toEqual([
            'yerbu:dev:CRON_SECRET',
            'yerbu:prod:CRON_SECRET',
        ])
        expect(err.message).toContain('2 secrets match *:*:CRON_SECRET')
        expect(err.message).not.toContain('prod-value')
        expect(err.message).not.toContain('dev-value')
        expect(JSON.stringify(err)).not.toContain('prod-value')
    })

    it('get_sync() behaves the same', async () => {
        await init()
        expect(get_sync('yerbu:prod:CRON_SECRET')).toBe('prod-value')
        expect(() => get_sync('::CRON_SECRET')).toThrow(AmbiguousSecret)
        expect(() => get_sync('yerbu:test:CRON_SECRET')).toThrow(SecretNotFound)
    })
})

describe('core barrel', () => {
    it('exports the errors and parse_reference', () => {
        expect(core.SecretNotFound).toBe(SecretNotFound)
        expect(core.AmbiguousSecret).toBe(AmbiguousSecret)
        expect(core.parse_reference).toBe(parse_reference)
    })
})
