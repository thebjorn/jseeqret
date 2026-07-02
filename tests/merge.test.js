import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import { JsonCryptSerializer } from '../src/core/serializers/json-crypt.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import {
    plan_secret_merge,
    apply_secret_merge,
    resolve_conflict,
    secret_id,
} from '../src/core/merge.js'

let vault_dir, storage, kp

function make_secret(key, value, extras = {}) {
    return new Secret({
        app: 'myapp', env: 'prod', key,
        plaintext_value: value, vault_dir, ...extras,
    })
}

beforeEach(async () => {
    vault_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-merge-'))
    kp = generate_and_save_key_pair(vault_dir)
    generate_symmetric_key(vault_dir)
    await run_migrations(vault_dir, 'me@host', 'me@test.com', encode_key(kp.publicKey))
    storage = new SqliteStorage('seeqrets.db', vault_dir)
})

afterEach(() => {
    try { fs.rmSync(vault_dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('updated_at storage semantics (migration v006)', () => {
    it('add_secret stamps now when the secret carries no timestamp', async () => {
        const before = Math.floor(Date.now() / 1000)
        await storage.add_secret(make_secret('A', 'v1'))
        const [s] = await storage.fetch_secrets({ key: 'A' })
        expect(s.updated_at).toBeGreaterThanOrEqual(before)
    })

    it('add/upsert preserve a carried timestamp (imports keep provenance)', async () => {
        await storage.add_secret(make_secret('A', 'v1', { updated_at: 1111 }))
        expect((await storage.fetch_secrets({ key: 'A' }))[0].updated_at).toBe(1111)

        await storage.upsert_secret(make_secret('A', 'v2', { updated_at: 2222 }))
        const [s] = await storage.fetch_secrets({ key: 'A' })
        expect(s.get_value()).toBe('v2')
        expect(s.updated_at).toBe(2222)
    })

    it('update_secret always stamps now (local modification)', async () => {
        await storage.add_secret(make_secret('A', 'v1', { updated_at: 1111 }))
        const [s] = await storage.fetch_secrets({ key: 'A' })
        const before = Math.floor(Date.now() / 1000)
        s.set_value('v2')
        await storage.update_secret(s)
        const [after] = await storage.fetch_secrets({ key: 'A' })
        expect(after.updated_at).toBeGreaterThanOrEqual(before)
    })

    it('a pre-v006 vault (no column) still reads and writes', async () => {
        // Simulate an un-upgraded vault: hand-built v005-era secrets table.
        const old_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-merge-old-'))
        generate_symmetric_key(old_dir)
        const old_storage = new SqliteStorage('seeqrets.db', old_dir)
        await old_storage.execute_write_sql(`
            CREATE TABLE secrets (
                id INTEGER PRIMARY KEY,
                app TEXT NOT NULL, env TEXT NOT NULL, key TEXT NOT NULL,
                value TEXT NOT NULL, type TEXT NOT NULL DEFAULT('str'),
                UNIQUE(app, env, key)
            )`)
        const secret = new Secret({
            app: 'a', env: 'e', key: 'K',
            plaintext_value: 'v', vault_dir: old_dir,
        })
        await old_storage.add_secret(secret)
        await old_storage.upsert_secret(secret)
        const [s] = await old_storage.fetch_secrets({ key: 'K' })
        expect(s.get_value()).toBe('v')
        expect(s.updated_at).toBeNull()
        fs.rmSync(old_dir, { recursive: true, force: true })
    })
})

describe('json-crypt carries updated_at', () => {
    it('round-trips the timestamp; absent timestamps load as null', async () => {
        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-merge-b-'))
        const other_kp = generate_and_save_key_pair(other)
        generate_symmetric_key(other)
        const me = new User('me@host', 'me@test.com', encode_key(kp.publicKey))
        const them = new User('them@host', 'them@test.com', encode_key(other_kp.publicKey))

        const exporter = new JsonCryptSerializer({
            sender: me, receiver: them, sender_private_key: kp.secretKey,
        })
        const text = exporter.dumps([
            make_secret('A', 'v1', { updated_at: 1234 }),
        ])
        expect(JSON.parse(text).secrets[0].updated_at).toBe(1234)

        const importer = new JsonCryptSerializer({
            sender: me, receiver_private_key: other_kp.secretKey,
        })
        const [loaded] = importer.load(text)
        expect(loaded.updated_at).toBe(1234)

        // Old exporters omit the field entirely.
        const legacy = JSON.parse(text)
        delete legacy.secrets[0].updated_at
        const [old_style] = importer.load(JSON.stringify(legacy))
        expect(old_style.updated_at).toBeNull()
        fs.rmSync(other, { recursive: true, force: true })
    })
})

describe('plan_secret_merge', () => {
    it('classifies additions / identical / conflicts without writing', async () => {
        await storage.add_secret(make_secret('SAME', 'v'))
        await storage.add_secret(make_secret('DIFF', 'local'))

        const plan = await plan_secret_merge(storage, [
            make_secret('NEW', 'v'),
            make_secret('SAME', 'v'),
            make_secret('DIFF', 'incoming'),
        ])

        expect(plan.additions.map(s => s.key)).toEqual(['NEW'])
        expect(plan.identical.map(s => s.key)).toEqual(['SAME'])
        expect(plan.conflicts.map(c => c.incoming.key)).toEqual(['DIFF'])
        // Read-only: nothing was written.
        expect(await storage.fetch_secrets({ key: 'NEW' })).toHaveLength(0)
        expect((await storage.fetch_secrets({ key: 'DIFF' }))[0].get_value())
            .toBe('local')
    })

    it('a type change on the same value is a conflict', async () => {
        await storage.add_secret(make_secret('N', '42'))
        const plan = await plan_secret_merge(storage, [
            make_secret('N', '42', { type: 'int' }),
        ])
        expect(plan.conflicts).toHaveLength(1)
    })
})

describe('resolve_conflict', () => {
    const conflict = (local_ts, incoming_ts) => ({
        local: { updated_at: local_ts },
        incoming: { updated_at: incoming_ts },
    })

    it('mine/theirs are unconditional', () => {
        expect(resolve_conflict(conflict(1, 2), 'mine')).toBe('mine')
        expect(resolve_conflict(conflict(2, 1), 'theirs')).toBe('theirs')
    })

    it('newer compares timestamps; ties and unknowns keep local', () => {
        expect(resolve_conflict(conflict(1, 2), 'newer')).toBe('theirs')
        expect(resolve_conflict(conflict(2, 1), 'newer')).toBe('mine')
        expect(resolve_conflict(conflict(5, 5), 'newer')).toBe('mine')
        expect(resolve_conflict(conflict(5, null), 'newer')).toBe('mine')
        expect(resolve_conflict(conflict(null, 5), 'newer')).toBe('theirs')
    })

    it('rejects unknown strategies', () => {
        expect(() => resolve_conflict(conflict(1, 2), 'yolo')).toThrow(/strategy/)
    })
})

describe('apply_secret_merge', () => {
    it('applies per-secret resolutions; unresolved are reported, not written', async () => {
        await storage.add_secret(make_secret('A', 'local-a'))
        await storage.add_secret(make_secret('B', 'local-b'))
        await storage.add_secret(make_secret('C', 'local-c'))

        const plan = await plan_secret_merge(storage, [
            make_secret('A', 'incoming-a'),
            make_secret('B', 'incoming-b'),
            make_secret('C', 'incoming-c'),
            make_secret('NEW', 'fresh'),
        ])
        const r = await apply_secret_merge(storage, plan, {
            resolutions: {
                'myapp:prod:A': 'theirs',
                'myapp:prod:B': 'mine',
                // C deliberately unresolved
            },
        })

        expect(r).toMatchObject({ added: 1, updated: 1, kept: 1, skipped: 0 })
        expect(r.unresolved.map(c => c.incoming.key)).toEqual(['C'])
        expect((await storage.fetch_secrets({ key: 'A' }))[0].get_value())
            .toBe('incoming-a')
        expect((await storage.fetch_secrets({ key: 'B' }))[0].get_value())
            .toBe('local-b')
        expect((await storage.fetch_secrets({ key: 'C' }))[0].get_value())
            .toBe('local-c')
    })

    it('the newer strategy resolves everything by timestamp', async () => {
        await storage.add_secret(make_secret('OLD', 'local', { updated_at: 100 }))
        await storage.add_secret(make_secret('FRESH', 'local', { updated_at: 900 }))

        const plan = await plan_secret_merge(storage, [
            make_secret('OLD', 'incoming', { updated_at: 500 }),
            make_secret('FRESH', 'incoming', { updated_at: 500 }),
        ])
        const r = await apply_secret_merge(storage, plan, { strategy: 'newer' })

        expect(r).toMatchObject({ updated: 1, kept: 1, unresolved: [] })
        const [old_s] = await storage.fetch_secrets({ key: 'OLD' })
        expect(old_s.get_value()).toBe('incoming')
        expect(old_s.updated_at).toBe(500)   // provenance preserved
        expect((await storage.fetch_secrets({ key: 'FRESH' }))[0].get_value())
            .toBe('local')
    })

    it('identical secrets are skipped and keep their local timestamp', async () => {
        await storage.add_secret(make_secret('S', 'v', { updated_at: 100 }))
        const plan = await plan_secret_merge(storage, [
            make_secret('S', 'v', { updated_at: 999 }),
        ])
        const r = await apply_secret_merge(storage, plan, {})
        expect(r.skipped).toBe(1)
        expect((await storage.fetch_secrets({ key: 'S' }))[0].updated_at).toBe(100)
    })

    it('secret_id formats the identity key', () => {
        expect(secret_id({ app: 'a', env: 'e', key: 'K' })).toBe('a:e:K')
    })
})
