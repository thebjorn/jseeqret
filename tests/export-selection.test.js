import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { run_migrations } from '../src/core/migrations.js'
import { generate_symmetric_key, generate_and_save_key_pair } from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import { select_export_secrets } from '../src/main/export-selection.js'
import { apply_column_filters } from '../src/renderer/src/lib/column-filters.js'

let tmp_dir
let storage

const SECRETS = [
    ['web', 'prod', 'DB_PASSWORD'],
    ['web', 'dev', 'DB_PASSWORD'],
    ['api', 'prod', 'API_TOKEN'],
    ['api', 'test', 'PORT'],
]

function ids(secrets) {
    return secrets.map(s => `${s.app}:${s.env}:${s.key}`).sort()
}

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-test-'))
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    const pubkey = encode_key(key_pair.publicKey)
    await run_migrations(tmp_dir, 'testuser', 'test@test.com', pubkey)
    process.env.JSEEQRET = tmp_dir
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
    for (const [app, env, key] of SECRETS) {
        await storage.add_secret(new Secret({ app, env, key, value: 'x' }))
    }
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('select_export_secrets', () => {
    it('without keys returns every pattern match', async () => {
        const r = await select_export_secrets(storage, '*:*:*')
        expect(r).toHaveLength(4)
    })

    it('keys narrow the pattern matches', async () => {
        const r = await select_export_secrets(
            storage, '*:*:*', ['web:prod:DB_PASSWORD', 'api:test:PORT'],
        )
        expect(ids(r)).toEqual(['api:test:PORT', 'web:prod:DB_PASSWORD'])
    })

    it('keys never add secrets outside the pattern', async () => {
        const r = await select_export_secrets(
            storage, 'web:*:*', ['web:prod:DB_PASSWORD', 'api:prod:API_TOKEN'],
        )
        expect(ids(r)).toEqual(['web:prod:DB_PASSWORD'])
    })

    it('ignores keys that do not exist', async () => {
        const r = await select_export_secrets(
            storage, '*:*:*', ['nope:prod:X'],
        )
        expect(r).toEqual([])
    })

    it('an empty key list exports nothing', async () => {
        const r = await select_export_secrets(storage, '*:*:*', [])
        expect(r).toEqual([])
    })
})

// End to end over the export path: the export view's column filters
// pick the rows, their ids go to the main process, and only those rows
// are exported.
describe('table filters limit the export', () => {
    async function export_with(column_filters) {
        const preview = await select_export_secrets(storage, '*:*:*')
        const shown = apply_column_filters(preview, column_filters)
        return select_export_secrets(storage, '*:*:*', ids(shown))
    }

    it('app + env selections', async () => {
        const r = await export_with({ app: ['web'], env: ['prod'], key: '' })
        expect(ids(r)).toEqual(['web:prod:DB_PASSWORD'])
    })

    it('multiple env values', async () => {
        const r = await export_with({ app: [], env: ['prod', 'test'], key: '' })
        expect(ids(r)).toEqual([
            'api:prod:API_TOKEN', 'api:test:PORT', 'web:prod:DB_PASSWORD',
        ])
    })

    it('key search', async () => {
        const r = await export_with({ app: [], env: [], key: 'db_' })
        expect(ids(r)).toEqual(['web:dev:DB_PASSWORD', 'web:prod:DB_PASSWORD'])
    })

    it('no filters exports everything', async () => {
        const r = await export_with({ app: [], env: [], key: '' })
        expect(r).toHaveLength(4)
    })
})
