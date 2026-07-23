/**
 * Core `receive_secrets` (src/core/slack/receive.js): the shared engine
 * behind `jseeqret receive --via slack` and the GUI Import page.
 *
 * Includes the regression for the pre-fix crash: typed onboarding
 * envelopes addressed to the receiver used to be fed to the json-crypt
 * serializer, which blew up on `data.secrets.map` (undefined).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MockSlackWorkspace } from './slack-mock.js'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { Secret } from '../src/core/models/secret.js'
import { User } from '../src/core/models/user.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import { bind_slack_handle } from '../src/core/slack/identity.js'
import { MESSAGE_KINDS } from '../src/core/serializers/envelope.js'
import { JsonCryptSerializer } from '../src/core/serializers/json-crypt.js'
import { send_blob, send_payload } from '../src/core/slack/transport.js'
import { SLACK_KEYS, slack_config_get } from '../src/core/slack/config.js'
import { receive_secrets } from '../src/core/slack/receive.js'

const CHANNEL = 'C_SEEQRETS'

let alice_dir, bob_dir
let alice_kp, bob_kp
let alice_user, bob_user
let bob_storage
let ws

function make_vault(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    const kp = generate_and_save_key_pair(dir)
    generate_symmetric_key(dir)
    return { dir, kp }
}

beforeEach(async () => {
    // Bob is the receiver; his vault dir is the active one (Secret
    // objects built by the serializer encrypt with its symmetric key).
    const bob = make_vault('jseeqret-recv-bob-')
    bob_dir = bob.dir
    bob_kp = bob.kp
    process.env.JSEEQRET = bob_dir
    await run_migrations(bob_dir, 'bob@host', 'bob@test.com', encode_key(bob_kp.publicKey))
    bob_storage = new SqliteStorage('seeqrets.db', bob_dir)
    bob_user = new User('bob@host', 'bob@test.com', encode_key(bob_kp.publicKey))

    // Alice is the sender; she only needs keys, no database.
    const alice = make_vault('jseeqret-recv-alice-')
    alice_dir = alice.dir
    alice_kp = alice.kp
    alice_user = new User('alice@host', 'alice@test.com', encode_key(alice_kp.publicKey))

    // Bob knows alice and has linked her Slack handle (the mock's
    // users.info reports the user_id as the handle).
    await bob_storage.add_user(alice_user)
    await bind_slack_handle(bob_storage, 'alice@host', 'U_ALICE')

    ws = new MockSlackWorkspace()
})

afterEach(() => {
    delete process.env.JSEEQRET
    for (const d of [alice_dir, bob_dir]) {
        try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
})

/** Alice exports `specs` for bob and posts the blob on the channel. */
function alice_sends(specs) {
    const ser = new JsonCryptSerializer({
        sender: alice_user,
        receiver: bob_user,
        sender_private_key: alice_kp.secretKey,
    })
    const secrets = specs.map(s => new Secret({ ...s, vault_dir: alice_dir }))
    return send_blob({
        client: ws.client('U_ALICE'),
        channel_id: CHANNEL,
        recipient_slack_user_id: 'U_BOB',
        ciphertext: ser.dumps(secrets),
    })
}

function bob_receives(opts = {}) {
    return receive_secrets(bob_storage, ws.client('U_BOB'), {
        channel_id: CHANNEL,
        self_user_id: 'U_BOB',
        receiver_private_key: bob_kp.secretKey,
        oldest_ts: opts.oldest_ts || '0',
        strategy: opts.strategy || null,
        resolutions: opts.resolutions || null,
    })
}

async function bob_value(key) {
    const rows = await bob_storage.fetch_secrets({
        app: 'myapp', env: 'prod', key,
    })
    return rows.length ? rows[0].get_value() : null
}

function cursor() {
    return slack_config_get(bob_storage, SLACK_KEYS.last_seen_ts)
}

describe('receive_secrets', () => {
    it('imports a secret blob, deletes the thread, advances the cursor', async () => {
        const sent = await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 's3cret' },
        ])

        const r = await bob_receives()

        expect(r.needs_resolution).toBe(false)
        expect(r.imported).toBe(1)
        expect(r.added).toBe(1)
        expect(await bob_value('DB_PASS')).toBe('s3cret')
        // Forward secrecy: file and mention are gone from the channel.
        expect(ws.files[sent.file_id]).toBeUndefined()
        expect(ws.messages).toHaveLength(0)
        expect(await cursor()).toBe(sent.file_ts)
    })

    it('skips onboarding envelopes instead of crashing (regression)', async () => {
        // A typed envelope addressed to bob from an unlinked sender --
        // this is exactly the frame shape that used to crash receive
        // with "Cannot read properties of undefined (reading 'map')".
        await send_payload({
            client: ws.client('U_TL'),
            channel_id: CHANNEL,
            recipient_slack_user_id: 'U_BOB',
            kind: MESSAGE_KINDS.user_list,
            payload: { users: [] },
        })
        await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 's3cret' },
        ])

        const r = await bob_receives()

        expect(r.imported).toBe(1)
        expect(await bob_value('DB_PASS')).toBe('s3cret')
        // The envelope stays on Slack for the onboarding pollers.
        expect(ws.messages.filter(m => m.files)).toHaveLength(1)
    })

    it('fails closed on a conflict: nothing written, blob kept, cursor parked', async () => {
        await bob_storage.add_secret(new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'local-version', vault_dir: bob_dir,
        }))
        const sent = await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 'alice-version' },
        ])

        const r = await bob_receives()

        expect(r.needs_resolution).toBe(true)
        expect(r.imported).toBe(0)
        expect(r.conflict_sender).toBe('alice@host')
        expect(r.conflicts).toHaveLength(1)
        expect(r.conflicts[0].id).toBe('myapp:prod:DB_PASS')
        expect(r.conflicts[0].local_value).toBe('local-version')
        expect(r.conflicts[0].incoming_value).toBe('alice-version')
        expect(await bob_value('DB_PASS')).toBe('local-version')
        expect(ws.files[sent.file_id]).toBeDefined()
        expect(await cursor()).toBeNull()
    })

    it('applies per-secret resolutions on the second call', async () => {
        await bob_storage.add_secret(new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'local-version', vault_dir: bob_dir,
        }))
        const sent = await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 'alice-version' },
        ])
        await bob_receives()   // phase 1: reports the conflict

        const r = await bob_receives({
            resolutions: { 'myapp:prod:DB_PASS': 'theirs' },
        })

        expect(r.needs_resolution).toBe(false)
        expect(r.updated).toBe(1)
        expect(await bob_value('DB_PASS')).toBe('alice-version')
        expect(ws.files[sent.file_id]).toBeUndefined()
        expect(await cursor()).toBe(sent.file_ts)
    })

    it("strategy 'mine' keeps the local value and still cleans up", async () => {
        await bob_storage.add_secret(new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'local-version', vault_dir: bob_dir,
        }))
        const sent = await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 'alice-version' },
        ])

        const r = await bob_receives({ strategy: 'mine' })

        expect(r.needs_resolution).toBe(false)
        expect(r.imported).toBe(0)
        expect(r.kept).toBe(1)
        expect(await bob_value('DB_PASS')).toBe('local-version')
        expect(ws.files[sent.file_id]).toBeUndefined()
        expect(await cursor()).toBe(sent.file_ts)
    })

    it('imports clean blobs before parking on a conflicted one', async () => {
        const first = await alice_sends([
            { app: 'myapp', env: 'prod', key: 'PORT', plaintext_value: '5432' },
        ])
        await bob_storage.add_secret(new Secret({
            app: 'myapp', env: 'prod', key: 'DB_PASS',
            plaintext_value: 'local-version', vault_dir: bob_dir,
        }))
        await alice_sends([
            { app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 'alice-version' },
        ])

        const r = await bob_receives()

        expect(r.imported).toBe(1)
        expect(r.needs_resolution).toBe(true)
        expect(await bob_value('PORT')).toBe('5432')
        expect(await bob_value('DB_PASS')).toBe('local-version')
        // Cursor advanced past the imported blob only, so the conflicted
        // one is seen again next call.
        expect(await cursor()).toBe(first.file_ts)
    })

    it('rejects a blob from an unlinked Slack sender (fail closed)', async () => {
        const legacy = JSON.stringify({
            version: 1, from: 'mallory', to: 'bob@host',
            secrets: [], signature: 'zzzzz',
        })
        await send_blob({
            client: ws.client('U_MALLORY'),
            channel_id: CHANNEL,
            recipient_slack_user_id: 'U_BOB',
            ciphertext: legacy,
        })

        await expect(bob_receives()).rejects.toThrow(/unknown Slack handle/)
        expect(ws.messages.filter(m => m.files)).toHaveLength(1)
        expect(await cursor()).toBeNull()
    })
})
