import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { User } from '../src/core/models/user.js'
import { run_migrations } from '../src/core/migrations.js'
import {
    generate_symmetric_key, generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import { current_user, qualified_user } from '../src/core/vault.js'
import {
    resolve_user,
    resolve_recipients,
    fetch_self,
    AmbiguousUserError,
    UnknownUserError,
} from '../src/core/user-resolve.js'

const PUBKEY = 'MBiGKmtpckXspJkmijIPXd8GrIAgAdLOoM4pZNOyDzw='

let tmp_dir
let storage

beforeEach(async () => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-resolve-'))
    const key_pair = generate_and_save_key_pair(tmp_dir)
    generate_symmetric_key(tmp_dir)
    const pubkey = encode_key(key_pair.publicKey)
    // Owner is a plain bare name so it never collides with the
    // qualified/bare users each test adds.
    await run_migrations(tmp_dir, 'owner', 'owner@test.com', pubkey)
    storage = new SqliteStorage('seeqrets.db', tmp_dir)
    process.env.JSEEQRET = tmp_dir
})

afterEach(() => {
    delete process.env.JSEEQRET
    fs.rmSync(tmp_dir, { recursive: true, force: true })
})

describe('resolve_user', () => {
    it('resolves an exact qualified name', async () => {
        await storage.add_user(new User('bjorn@host1', 'b@test.com', PUBKEY))
        const u = await resolve_user(storage, 'bjorn@host1')
        expect(u.username).toBe('bjorn@host1')
    })

    it('falls back from a bare name to a unique qualified user', async () => {
        await storage.add_user(new User('bjorn@host1', 'b@test.com', PUBKEY))
        const u = await resolve_user(storage, 'bjorn')
        expect(u.username).toBe('bjorn@host1')
    })

    it('prefers an exact bare match over a prefix match', async () => {
        await storage.add_user(new User('bjorn', 'legacy@test.com', PUBKEY))
        await storage.add_user(new User('bjorn@host1', 'b@test.com', PUBKEY))
        const u = await resolve_user(storage, 'bjorn')
        expect(u.username).toBe('bjorn')
        expect(u.email).toBe('legacy@test.com')
    })

    it('throws AmbiguousUserError for an ambiguous bare name', async () => {
        await storage.add_user(new User('bjorn@oldpc', 'b@test.com', PUBKEY))
        await storage.add_user(new User('bjorn@newpc', 'b@test.com', PUBKEY))
        await expect(resolve_user(storage, 'bjorn'))
            .rejects.toBeInstanceOf(AmbiguousUserError)
    })

    it('throws UnknownUserError for an unknown name', async () => {
        await expect(resolve_user(storage, 'nobody'))
            .rejects.toBeInstanceOf(UnknownUserError)
    })

    it('does not fall back for a qualified name that does not exist', async () => {
        await storage.add_user(new User('bjorn@host1', 'b@test.com', PUBKEY))
        await expect(resolve_user(storage, 'bjorn@host2'))
            .rejects.toBeInstanceOf(UnknownUserError)
    })
})

describe('fetch_self', () => {
    it('prefers the qualified identity over the bare one', async () => {
        await storage.add_user(new User(current_user(), 'bare@test.com', PUBKEY))
        await storage.add_user(new User(qualified_user(), 'qual@test.com', PUBKEY))
        const u = await fetch_self(storage)
        expect(u.username).toBe(qualified_user())
    })

    it('falls back to the bare username', async () => {
        await storage.add_user(new User(current_user(), 'bare@test.com', PUBKEY))
        const u = await fetch_self(storage)
        expect(u.username).toBe(current_user())
    })

    it('returns null when neither identity is registered', async () => {
        const u = await fetch_self(storage)
        expect(u).toBeNull()
    })
})

describe('resolve_recipients', () => {
    it('passes self through unchanged', async () => {
        const r = await resolve_recipients(storage, ['self'])
        expect(r).toEqual(['self'])
    })

    it('expands all to every user except the owner', async () => {
        await storage.add_user(new User('alice@h', 'a@test.com', PUBKEY))
        await storage.add_user(new User('bob@h', 'b@test.com', PUBKEY))
        const r = await resolve_recipients(storage, ['all'])
        expect(r).toEqual(['alice@h', 'bob@h'])
        expect(r).not.toContain('owner')
    })

    it('de-duplicates while preserving first-seen order', async () => {
        await storage.add_user(new User('bob@h', 'b@test.com', PUBKEY))
        const r = await resolve_recipients(storage, ['all', 'bob'])
        expect(r).toEqual(['bob@h'])
    })

    it('resolves bare names via resolve_user', async () => {
        await storage.add_user(new User('carol@h', 'c@test.com', PUBKEY))
        const r = await resolve_recipients(storage, ['carol'])
        expect(r).toEqual(['carol@h'])
    })
})
