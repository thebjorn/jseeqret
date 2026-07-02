import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { MockSlackWorkspace } from './slack-mock.js'
import { run_migrations } from '../src/core/migrations.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { User } from '../src/core/models/user.js'
import { Secret } from '../src/core/models/secret.js'
import {
    generate_symmetric_key,
    generate_and_save_key_pair,
} from '../src/core/crypto/utils.js'
import { encode_key } from '../src/core/crypto/nacl.js'
import {
    compute_fingerprint, require_verified_binding,
} from '../src/core/slack/identity.js'
import { MESSAGE_KINDS } from '../src/core/serializers/envelope.js'
import { send_payload, poll_envelopes } from '../src/core/slack/transport.js'
import { transport_selftest } from '../src/core/slack/selftest.js'
import { slack_config_get } from '../src/core/slack/config.js'
import {
    pubkey_fingerprint,
    onboard_invite,
    onboard_join,
    onboard_introduce,
    onboard_poll,
    onboard_approve,
    onboard_provision_poll,
    onboard_send_received_ack,
    inbox_introductions,
    accept_introduction,
    set_tl_trust,
} from '../src/core/onboarding.js'

const CHANNEL = 'C_SEEQRETS'

let tl_dir, user_dir, alice_dir
let tl_kp, user_kp, alice_kp
let tl_self, user_self
let tl_storage, user_storage, alice_storage
let ws

function make_vault(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    const kp = generate_and_save_key_pair(dir)
    generate_symmetric_key(dir)
    return { dir, kp }
}

beforeEach(async () => {
    const tl = make_vault('jseeqret-inbox-tl-')
    tl_dir = tl.dir
    tl_kp = tl.kp
    await run_migrations(tl_dir, 'lead@host', 'lead@test.com', encode_key(tl_kp.publicKey))
    tl_storage = new SqliteStorage('seeqrets.db', tl_dir)
    tl_self = new User('lead@host', 'lead@test.com', encode_key(tl_kp.publicKey))

    const u = make_vault('jseeqret-inbox-user-')
    user_dir = u.dir
    user_kp = u.kp
    await run_migrations(user_dir, 'newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey))
    user_storage = new SqliteStorage('seeqrets.db', user_dir)
    user_self = new User('newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey))

    const a = make_vault('jseeqret-inbox-alice-')
    alice_dir = a.dir
    alice_kp = a.kp
    await run_migrations(alice_dir, 'alice@host', 'alice@test.com', encode_key(alice_kp.publicKey))
    alice_storage = new SqliteStorage('seeqrets.db', alice_dir)
    await tl_storage.add_user(
        new User('alice@host', 'alice@test.com', encode_key(alice_kp.publicKey))
    )

    await tl_storage.add_secret(new Secret({
        app: 'myapp', env: 'prod', key: 'DB_PASS',
        plaintext_value: 's3cret', vault_dir: tl_dir,
    }))

    ws = new MockSlackWorkspace()
    ws.register_member('newbie@test.com', 'U_USER', 'newbie')
    ws.register_member('alice@test.com', 'U_ALICE', 'alice')
})

afterEach(() => {
    for (const d of [tl_dir, user_dir, alice_dir]) {
        try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
})

/** Run the full invite -> introduce -> poll -> approve handshake. */
async function complete_handshake({ self = user_self } = {}) {
    await onboard_invite(tl_storage, ws.client('U_TL'), {
        email: 'newbie@test.com', project: 'myapp:*:*',
        channel_id: CHANNEL, self: tl_self,
    })
    await set_tl_trust(user_storage, {
        user_id: 'U_TL', pubkey: tl_self.pubkey,
        fingerprint: compute_fingerprint(tl_self), project: 'myapp:*:*',
    })
    await onboard_introduce(user_storage, ws.client('U_USER'), {
        channel_id: CHANNEL, self, tl_slack_user_id: 'U_TL',
        email: 'newbie@test.com',
    })
    await onboard_poll(tl_storage, ws.client('U_TL'), {
        channel_id: CHANNEL, self_user_id: 'U_TL',
        receiver_private_key: tl_kp.secretKey,
    })
    const row = await tl_storage.onboarding_get('newbie@test.com')
    return onboard_approve(tl_storage, ws.client('U_TL'), {
        email: 'newbie@test.com', verified: true, fingerprint: row.fingerprint,
        channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
    })
}

/** A client whose deletes fail like a plain member's (cant_delete_message). */
function undeletable_client(user_id) {
    const base = ws.client(user_id)
    const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base)
    client.delete_message = async () => {
        throw new Error('An API error occurred: cant_delete_message')
    }
    client.delete_file = async () => {
        throw new Error('An API error occurred: cant_delete_file')
    }
    return client
}

describe('introduction carries the display name', () => {
    it('the user-chosen name is captured when the invite has none', async () => {
        const named_self = new User(
            'newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey),
            { name: 'Newbie Nilsen' },
        )
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: named_self, tl_slack_user_id: 'U_TL',
            email: 'newbie@test.com',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.name).toBe('Newbie Nilsen')
    })

    it('the invite-provided name wins over the user-chosen one', async () => {
        const named_self = new User(
            'newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey),
            { name: 'Self Chosen' },
        )
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'Steinar',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: named_self, tl_slack_user_id: 'U_TL',
            email: 'newbie@test.com',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.name).toBe('Steinar')
    })
})

describe('introductions inbox (existing-teammate side)', () => {
    it('the TL broadcast shows up as a pending, vouched introduction', async () => {
        await complete_handshake()

        const pending = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(pending).toHaveLength(1)
        expect(pending[0].vouched).toBe(true)
        expect(pending[0].users.map(u => u.username)).toContain('newbie@host')
        // Nothing was imported -- accept is a separate human decision.
        expect(await alice_storage.fetch_user('newbie@host')).toBeNull()
    })

    it('without TL trust the introduction is pending but unvouched', async () => {
        await complete_handshake()

        const pending = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: null,
        })
        expect(pending).toHaveLength(1)
        expect(pending[0].vouched).toBe(false)
        expect(pending[0].fingerprint).toBe(pubkey_fingerprint(tl_self.pubkey))
    })

    it('accept imports on the team lead\'s authority (vouched)', async () => {
        await complete_handshake()
        const [intro] = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })

        const imported = await accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: intro.payload,
            file_id: intro.file_id, reply_ts: intro.reply_ts,
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(imported.map(u => u.username)).toContain('newbie@host')
        expect(await alice_storage.fetch_user('newbie@host')).not.toBeNull()

        // Consumed: it no longer shows as pending (already in vault).
        const pending = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(pending).toHaveLength(0)
    })

    it('unvouched accept requires the OOB verification ceremony', async () => {
        await complete_handshake()
        const [intro] = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: null,
        })

        // No verification flag -> refused.
        await expect(accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: intro.payload,
            receiver_private_key: alice_kp.secretKey,
        })).rejects.toThrow(/out-of-band/i)

        // Wrong typed fingerprint -> refused.
        await expect(accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: intro.payload,
            receiver_private_key: alice_kp.secretKey,
            verified: true, fingerprint: 'zzzzz',
        })).rejects.toThrow(/fingerprint/i)
        expect(await alice_storage.fetch_user('newbie@host')).toBeNull()

        // Correct ceremony -> imported.
        const imported = await accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: intro.payload,
            receiver_private_key: alice_kp.secretKey,
            verified: true, fingerprint: intro.fingerprint,
        })
        expect(imported.map(u => u.username)).toContain('newbie@host')
    })

    it('a payload without a sender key is refused', async () => {
        await expect(accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: { users: 'garbage' },
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })).rejects.toThrow(/sender key/i)
    })
})

describe('received ack + sender-side cleanup', () => {
    it('the TL deletes their provisioning envelopes on a verified ack', async () => {
        await complete_handshake()

        // The receiver cannot delete the TL's messages, so the three
        // provisioning envelopes linger after a successful import.
        const user_client = undeletable_client('U_USER')
        const r = await onboard_provision_poll(user_storage, user_client, {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(r.complete).toBe(true)
        expect(r.warnings).toHaveLength(0)
        const sent = await slack_config_get(tl_storage, 'onboard.sent.newbie@test.com')
        expect(sent).toHaveLength(3)   // user_list + secret_batch + complete
        for (const s of sent) {
            expect(ws.files[s.file_id]).toBeDefined()
        }

        const ack = await onboard_send_received_ack(user_storage, user_client, {
            channel_id: CHANNEL, private_key: user_kp.secretKey,
        })
        expect(ack.sent).toBe(true)

        const poll = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
            receiver_private_key: tl_kp.secretKey,
        })
        const ev = poll.events.find(e => e.kind === 'received')
        expect(ev).toMatchObject({
            email: 'newbie@test.com', expected: true, cleaned: 3,
        })
        for (const s of sent) {
            expect(ws.files[s.file_id]).toBeUndefined()
        }
        // The recorded list is cleared once cleaned.
        expect(await slack_config_get(tl_storage, 'onboard.sent.newbie@test.com'))
            .toBeNull()
    })

    it('the ack is sent once (idempotent) unless forced', async () => {
        await complete_handshake()
        await set_tl_trust(user_storage, { user_id: 'U_TL', pubkey: tl_self.pubkey })

        const first = await onboard_send_received_ack(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, private_key: user_kp.secretKey,
        })
        const second = await onboard_send_received_ack(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, private_key: user_kp.secretKey,
        })
        expect(first.sent).toBe(true)
        expect(second.sent).toBe(false)
    })

    it('a forged ack (no valid proof) does not trigger cleanup', async () => {
        await complete_handshake()
        const sent = await slack_config_get(tl_storage, 'onboard.sent.newbie@test.com')
        expect(sent.length).toBeGreaterThan(0)

        // Attacker posts a plaintext ack claiming the invitee's email.
        await send_payload({
            client: ws.client('U_EVIL'), channel_id: CHANNEL,
            recipient_slack_user_id: 'U_TL',
            kind: MESSAGE_KINDS.received,
            payload: { email: 'newbie@test.com', proof: 'bogus' },
        })

        const poll = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
            receiver_private_key: tl_kp.secretKey,
        })
        const ev = poll.events.find(e => e.kind === 'received')
        expect(ev.expected).toBe(false)
        // Nothing deleted, record intact.
        for (const s of sent) {
            expect(ws.files[s.file_id]).toBeDefined()
        }
        expect(await slack_config_get(tl_storage, 'onboard.sent.newbie@test.com'))
            .toHaveLength(sent.length)
    })

    it('acks are left for a later poll when the TL key is unavailable', async () => {
        await complete_handshake()
        await onboard_send_received_ack(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, private_key: user_kp.secretKey,
            email: 'newbie@test.com',
        })

        // Poll WITHOUT the private key: the ack cannot be verified, so it
        // must not be consumed or trigger cleanup.
        const poll = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        expect(poll.events.find(e => e.kind === 'received')).toBeUndefined()
        const sent = await slack_config_get(tl_storage, 'onboard.sent.newbie@test.com')
        expect(sent.length).toBeGreaterThan(0)
    })
})

describe('verified bindings stamped on authenticated import', () => {
    // Regression: a provisioned vault could not send BACK to any teammate
    // ("not linked to a Slack handle") because import never recorded the
    // binding, even though the list arrived on the OOB-verified TL key.
    it('provisioned teammates are immediately sendable via Slack', async () => {
        await complete_handshake()
        await onboard_provision_poll(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })

        const lead = await require_verified_binding(user_storage, 'lead@host')
        expect(lead.slack_handle).toBe('lead')
        const alice = await require_verified_binding(user_storage, 'alice@host')
        expect(alice.slack_handle).toBe('alice')
    })

    it('accepted introductions are immediately sendable via Slack', async () => {
        await complete_handshake()
        const [intro] = await inbox_introductions(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, self_user_id: 'U_ALICE',
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        await accept_introduction(alice_storage, ws.client('U_ALICE'), {
            channel_id: CHANNEL, payload: intro.payload,
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })

        const bound = await require_verified_binding(alice_storage, 'newbie@host')
        expect(bound.slack_handle).toBe('newbie')
        expect(bound.user.slack_key_fingerprint)
            .toBe(compute_fingerprint(bound.user))
    })
})

describe('transport self-test', () => {
    it('sends to self, matches through the poller, and cleans up', async () => {
        const r = await transport_selftest(ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        expect(r).toMatchObject({
            ok: true, sent: true, matched: true, deleted: true, error: null,
        })
        // Nothing lingers in the channel.
        expect(Object.keys(ws.files)).toHaveLength(0)
        expect(ws.messages.filter(m => m.files?.length)).toHaveLength(0)
    })

    it('reports a cleanup failure without claiming success', async () => {
        const client = undeletable_client('U_TL')
        const r = await transport_selftest(client, {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        expect(r.matched).toBe(true)
        expect(r.deleted).toBe(false)
        expect(r.ok).toBe(false)
        expect(r.error).toMatch(/cleanup/i)
    })
})

describe('stale-noise poll cursor support', () => {
    it('provision poll reports a stale_ts for old unmatched envelopes', async () => {
        // An envelope addressed to somebody ELSE: this poller can never
        // match it, and the mock's ts values are ancient, so it counts as
        // permanently stale.
        await send_payload({
            client: ws.client('U_TL'), channel_id: CHANNEL,
            recipient_slack_user_id: 'U_ALICE',
            kind: MESSAGE_KINDS.invite, payload: { email: 'alice@test.com' },
        })

        const r = await onboard_provision_poll(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(r.stale_ts).not.toBeNull()
        expect(r.warnings).toHaveLength(0)
    })

    it('poll_envelopes never marks a fresh unmatched message stale', async () => {
        await send_payload({
            client: ws.client('U_TL'), channel_id: CHANNEL,
            recipient_slack_user_id: 'U_ALICE',
            kind: MESSAGE_KINDS.invite, payload: { email: 'alice@test.com' },
        })
        // Rewrite the message ts values to "now" so they are young.
        const now = (Date.now() / 1000).toFixed(6)
        for (const m of ws.messages) m.ts = String(Number(now) + Math.random())

        const stats = {}
        for await (const _ of poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL,
            self_user_id: 'U_USER', stats,
        })) { /* nothing addressed to me */ }
        expect(stats.stale_ts).toBeUndefined()
    })
})

describe('SqliteStorage.update_user', () => {
    it('updates name and email in place', async () => {
        await tl_storage.update_user('alice@host', {
            name: 'Alice A', email: 'alice@new.com',
        })
        const u = await tl_storage.fetch_user('alice@host')
        expect(u.name).toBe('Alice A')
        expect(u.email).toBe('alice@new.com')
    })

    it('a pubkey change clears the verified slack binding', async () => {
        await tl_storage.update_user_slack('alice@host', {
            slack_handle: 'alice', slack_key_fingerprint: 'abcde',
            slack_verified_at: 1234,
        })
        await tl_storage.update_user('alice@host', {
            pubkey: encode_key(user_kp.publicKey),
        })
        const u = await tl_storage.fetch_user('alice@host')
        expect(u.pubkey).toBe(encode_key(user_kp.publicKey))
        expect(u.slack_key_fingerprint).toBeNull()
        expect(u.slack_verified_at).toBeNull()
    })

    it('re-writing the SAME pubkey keeps the binding', async () => {
        const original = (await tl_storage.fetch_user('alice@host')).pubkey
        await tl_storage.update_user_slack('alice@host', {
            slack_handle: 'alice', slack_key_fingerprint: 'abcde',
            slack_verified_at: 1234,
        })
        await tl_storage.update_user('alice@host', {
            pubkey: original, name: 'Alice',
        })
        const u = await tl_storage.fetch_user('alice@host')
        expect(u.slack_key_fingerprint).toBe('abcde')
        expect(u.slack_verified_at).toBe(1234)
    })

    it('an empty update is a no-op', async () => {
        const before = await tl_storage.fetch_user('alice@host')
        await tl_storage.update_user('alice@host', {})
        const after = await tl_storage.fetch_user('alice@host')
        expect(after.toJSON()).toEqual(before.toJSON())
    })
})
