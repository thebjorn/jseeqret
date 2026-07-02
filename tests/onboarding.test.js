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
import { compute_fingerprint } from '../src/core/slack/identity.js'
import { MESSAGE_KINDS } from '../src/core/serializers/envelope.js'
import { poll_envelopes } from '../src/core/slack/transport.js'
import {
    ONBOARDING_STATES,
    pubkey_fingerprint,
    pubkeys_equal,
    is_trusted_sender,
    onboard_invite,
    onboard_receive_invite,
    onboard_join,
    onboard_poll,
    onboard_approve,
    onboard_provision_poll,
    import_user_list,
    import_secret_batch,
    expire_stale_onboarding,
    set_tl_trust,
    get_tl_trust,
} from '../src/core/onboarding.js'

const CHANNEL = 'C_SEEQRETS'

let tl_dir, user_dir
let tl_kp, user_kp, alice_kp, bob_kp
let tl_self, user_self
let tl_storage, user_storage
let ws

function make_vault(prefix, owner_username, owner_email) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    const kp = generate_and_save_key_pair(dir)
    generate_symmetric_key(dir)
    return { dir, kp }
}

beforeEach(async () => {
    // Team-lead vault, owner = lead@host
    const tl = make_vault('jseeqret-onb-tl-')
    tl_dir = tl.dir
    tl_kp = tl.kp
    await run_migrations(tl_dir, 'lead@host', 'lead@test.com', encode_key(tl_kp.publicKey))
    tl_storage = new SqliteStorage('seeqrets.db', tl_dir)
    tl_self = new User('lead@host', 'lead@test.com', encode_key(tl_kp.publicKey))

    // New-user vault, owner = newbie@host
    const u = make_vault('jseeqret-onb-user-')
    user_dir = u.dir
    user_kp = u.kp
    await run_migrations(user_dir, 'newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey))
    user_storage = new SqliteStorage('seeqrets.db', user_dir)
    user_self = new User('newbie@host', 'newbie@test.com', encode_key(user_kp.publicKey))

    // Existing teammates in the TL vault.
    alice_kp = generate_and_save_key_pair(fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-onb-alice-')))
    bob_kp = generate_and_save_key_pair(fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-onb-bob-')))
    await tl_storage.add_user(new User('alice@host', 'alice@test.com', encode_key(alice_kp.publicKey)))
    await tl_storage.add_user(new User('bob@host', 'bob@test.com', encode_key(bob_kp.publicKey)))

    // Secrets in the TL vault: two match myapp:*:*, one does not.
    await tl_storage.add_secret(new Secret({ app: 'myapp', env: 'prod', key: 'DB_PASS', plaintext_value: 's3cret', vault_dir: tl_dir }))
    await tl_storage.add_secret(new Secret({ app: 'myapp', env: 'dev', key: 'PORT', plaintext_value: '5432', type: 'int', vault_dir: tl_dir }))
    await tl_storage.add_secret(new Secret({ app: 'otherapp', env: 'prod', key: 'NOPE', plaintext_value: 'hidden', vault_dir: tl_dir }))

    // Mock workspace + directory.
    ws = new MockSlackWorkspace()
    ws.register_member('newbie@test.com', 'U_USER', 'newbie')
    ws.register_member('alice@test.com', 'U_ALICE', 'alice')
    // bob deliberately NOT in the workspace directory (broadcast skips him).
})

afterEach(() => {
    for (const d of [tl_dir, user_dir]) {
        try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
})

async function collect(gen) {
    const out = []
    for await (const item of gen) out.push(item)
    return out
}

describe('onboarding helpers', () => {
    it('pubkey_fingerprint matches compute_fingerprint(user)', () => {
        expect(pubkey_fingerprint(tl_self.pubkey)).toBe(compute_fingerprint(tl_self))
    })

    it('is_trusted_sender compares against the verified fingerprint', () => {
        const fp = compute_fingerprint(tl_self)
        expect(is_trusted_sender(tl_self.pubkey, fp)).toBe(true)
        expect(is_trusted_sender(tl_self.pubkey, 'zzzzz')).toBe(false)
    })

    it('pubkeys_equal does a full-key constant-time compare', () => {
        expect(pubkeys_equal(tl_self.pubkey, tl_self.pubkey)).toBe(true)
        expect(pubkeys_equal(tl_self.pubkey, user_self.pubkey)).toBe(false)
        expect(pubkeys_equal(tl_self.pubkey, null)).toBe(false)
        expect(pubkeys_equal(null, null)).toBe(false)
    })
})

describe('onboard_invite (TL, steps 1-4)', () => {
    it('persists an invited row and posts an addressed invite envelope', async () => {
        const r = await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com',
            project: 'myapp:*:*',
            name: 'newbie@host',
            channel_id: CHANNEL,
            self: tl_self,
        })

        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.state).toBe(ONBOARDING_STATES.invited)
        expect(row.project_filter).toBe('myapp:*:*')
        expect(row.slack_user_id).toBe('U_USER')
        expect(r.slack_user_id).toBe('U_USER')

        // The invite is addressed to the new user and carries TL identity.
        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        expect(got).toHaveLength(1)
        expect(got[0].kind).toBe(MESSAGE_KINDS.invite)
        expect(got[0].payload.tl_pubkey).toBe(tl_self.pubkey)
        expect(got[0].payload.tl_fingerprint).toBe(compute_fingerprint(tl_self))
    })

    it('throws when the invitee is not in the Slack workspace', async () => {
        await expect(onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'ghost@test.com', project: 'x:*:*', channel_id: CHANNEL, self: tl_self,
        })).rejects.toThrow(/workspace/i)
    })

    it('refuses to re-invite an in-progress email (would clobber capture)', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', channel_id: CHANNEL, self: tl_self,
        })
        // Capture a fingerprint, as the watch loop would.
        await tl_storage.onboarding_update('newbie@test.com', {
            fingerprint: 'abcde', pubkey: 'PK', state: 'introduced',
        })

        await expect(onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'other:*:*', channel_id: CHANNEL, self: tl_self,
        })).rejects.toThrow(/already in progress/i)

        // The captured fingerprint is intact.
        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.fingerprint).toBe('abcde')
    })

    it('allows re-inviting (resend) while the row is still invited', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', channel_id: CHANNEL, self: tl_self,
        })
        // Nothing captured yet at `invited`, so a resend is safe and must
        // not throw (the first invite may have been missed).
        await expect(onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', channel_id: CHANNEL, self: tl_self,
        })).resolves.toMatchObject({ slack_user_id: 'U_USER' })

        // A fresh invite envelope is delivered so the user can pick it up.
        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        expect(got.length).toBeGreaterThanOrEqual(1)
        expect(got[got.length - 1].kind).toBe(MESSAGE_KINDS.invite)
    })
})

describe('onboard_receive_invite + onboard_join (user, steps 5-7)', () => {
    it('user reads the invite then posts an introduction to the TL', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })

        const invite = await onboard_receive_invite(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
        })
        expect(invite).not.toBeNull()
        expect(invite.tl_slack_user_id).toBe('U_TL')
        expect(invite.tl_fingerprint).toBe(compute_fingerprint(tl_self))

        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })

        const intros = await collect(poll_envelopes({
            client: ws.client('U_TL'), channel_id: CHANNEL, self_user_id: 'U_TL',
        }))
        expect(intros).toHaveLength(1)
        expect(intros[0].kind).toBe(MESSAGE_KINDS.introduction)
        expect(intros[0].payload.email).toBe('newbie@test.com')
        expect(intros[0].payload.pubkey).toBe(user_self.pubkey)
    })
})

describe('onboard_poll (TL, steps 8-9)', () => {
    it('promotes invited -> introduced and captures fingerprint + pubkey', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })

        const result = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        expect(result.events.some(e => e.email === 'newbie@test.com' && e.expected)).toBe(true)

        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.state).toBe(ONBOARDING_STATES.introduced)
        expect(row.fingerprint).toBe(compute_fingerprint(user_self))
        expect(row.pubkey).toBe(user_self.pubkey)
        expect(row.slack_user_id).toBe('U_USER')
    })

    it('matches the introduction when the user vault email differs from the invited email', async () => {
        // A real freshly-created vault identifies as user@host with a
        // placeholder email, NOT the address the TL invited. The introduction
        // must still carry the invited email so the TL can match it.
        const diverged = new User(
            'WDAGUtilityAccount@box', 'WDAGUtilityAccount@box', user_self.pubkey
        )
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: diverged, tl_slack_user_id: 'U_TL',
            email: 'newbie@test.com',
        })

        const result = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        expect(result.events.some(e => e.email === 'newbie@test.com' && e.expected)).toBe(true)

        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.state).toBe(ONBOARDING_STATES.introduced)
        expect(row.pubkey).toBe(diverged.pubkey)
    })

    it('flags an introduction with no matching invite as unexpected', async () => {
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        const result = await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
        const ev = result.events.find(e => e.email === 'newbie@test.com')
        expect(ev.expected).toBe(false)
        // No row persisted for an uninvited introduction.
        expect(await tl_storage.onboarding_get('newbie@test.com')).toBeNull()
    })
})

describe('onboard_approve (TL, steps 10-16) — the fingerprint gate', () => {
    async function bring_to_introduced() {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), {
            channel_id: CHANNEL, self_user_id: 'U_TL',
        })
    }

    it('refuses without the verification flag (enforced in core)', async () => {
        await bring_to_introduced()
        await expect(onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: false,
            fingerprint: compute_fingerprint(user_self),
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })).rejects.toThrow(/verif/i)

        expect(await tl_storage.fetch_user('newbie@host')).toBeNull()
        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.state).toBe(ONBOARDING_STATES.introduced)
    })

    it('refuses when the typed-back fingerprint does not match', async () => {
        await bring_to_introduced()
        await expect(onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: 'wrong',
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })).rejects.toThrow(/fingerprint/i)
        expect(await tl_storage.fetch_user('newbie@host')).toBeNull()
    })

    it('on success: adds user, ships scoped secrets, marks complete', async () => {
        await bring_to_introduced()
        const row0 = await tl_storage.onboarding_get('newbie@test.com')

        const summary = await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })

        // New user is in the TL vault now.
        const added = await tl_storage.fetch_user('newbie@host')
        expect(added).not.toBeNull()
        expect(added.pubkey).toBe(user_self.pubkey)

        const row = await tl_storage.onboarding_get('newbie@test.com')
        expect(row.state).toBe(ONBOARDING_STATES.complete)
        expect(summary.secrets_sent).toBe(2)   // only myapp:*:*

        // user_list + secret_batch + complete are addressed to the new user.
        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        const kinds = got.map(g => g.kind)
        expect(kinds).toContain(MESSAGE_KINDS.user_list)
        expect(kinds).toContain(MESSAGE_KINDS.secret_batch)
        expect(kinds).toContain(MESSAGE_KINDS.complete)
    })

    it('is resumable + idempotent from a mid-sequence state', async () => {
        await bring_to_introduced()
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        const opts = {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        }
        await onboard_approve(tl_storage, ws.client('U_TL'), opts)
        // Simulate a crash mid-provision: the user was added but the row is
        // stuck at 'approved'. Re-running must continue, not throw on the
        // duplicate-username insert.
        await tl_storage.onboarding_set_state('newbie@test.com', 'approved')
        await expect(onboard_approve(tl_storage, ws.client('U_TL'), opts)).resolves.toBeTruthy()
        const users = (await tl_storage.fetch_users()).filter(u => u.username === 'newbie@host')
        expect(users).toHaveLength(1)
    })

    it('broadcasts the newcomer to resolvable existing teammates (resolved Q1)', async () => {
        await bring_to_introduced()
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })

        // Alice is in the workspace directory; she receives a user_list with
        // just the newcomer. Bob is not in the directory, so he is skipped.
        const for_alice = await collect(poll_envelopes({
            client: ws.client('U_ALICE'), channel_id: CHANNEL, self_user_id: 'U_ALICE',
        }))
        expect(for_alice).toHaveLength(1)
        expect(for_alice[0].kind).toBe(MESSAGE_KINDS.user_list)

        const imported = await import_user_list(alice_storage, for_alice[0].payload, {
            receiver_private_key: alice_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(imported.map(u => u.username)).toContain('newbie@host')
    })
})

describe('onboard_provision_poll (user, steps 13-16)', () => {
    it('imports teammates + scoped secrets when the TL key is trusted', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), { channel_id: CHANNEL, self_user_id: 'U_TL' })
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })

        const result = await onboard_provision_poll(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })

        expect(result.complete).toBe(true)
        expect(result.imported_users).toBeGreaterThanOrEqual(3) // lead, alice, bob

        const teammates = (await user_storage.fetch_users()).map(u => u.username)
        expect(teammates).toContain('lead@host')
        expect(teammates).toContain('alice@host')
        expect(teammates).toContain('bob@host')

        const secrets = await user_storage.fetch_secrets()
        expect(secrets).toHaveLength(2) // only myapp:*:*
        const db_pass = secrets.find(s => s.key === 'DB_PASS')
        expect(db_pass.get_value()).toBe('s3cret')
        expect(secrets.find(s => s.key === 'NOPE')).toBeUndefined()
    })

    it('imports nothing when the verified key is not the real TL key', async () => {
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), { channel_id: CHANNEL, self_user_id: 'U_TL' })
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })

        // A wrong trusted_pubkey (here the user's own key) cannot Box-open
        // the TL's envelopes, so every one is skipped — nothing imported,
        // not complete. Fail-closed without aborting on the first bad frame.
        const before = (await user_storage.fetch_users()).length
        const result = await onboard_provision_poll(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: user_self.pubkey,   // NOT the TL key
        })

        expect(result.imported_users).toBe(0)
        expect(result.imported_secrets).toBe(0)
        expect(result.complete).toBe(false)
        expect(result.warnings.length).toBeGreaterThan(0)
        expect((await user_storage.fetch_users()).length).toBe(before)
        expect(await user_storage.fetch_secrets()).toHaveLength(0)
    })

    it('import_user_list throws when the verified key cannot decrypt (forgery)', async () => {
        // Build a genuine user_list addressed to the user, then try to import
        // it claiming a DIFFERENT trusted key — Box.open must fail.
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), { channel_id: CHANNEL, self_user_id: 'U_TL' })
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })
        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        const ul = got.find(g => g.kind === MESSAGE_KINDS.user_list).payload

        // Even if an attacker spoofs from_pubkey to the real TL key, the
        // import authenticates by decrypting with trusted_pubkey, so a wrong
        // trusted_pubkey (or a forged ciphertext) cannot pass.
        await expect(import_user_list(user_storage, ul, {
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: user_self.pubkey,
        })).rejects.toThrow()
    })

    it('a plaintext complete with no Box proof does not finish provisioning', async () => {
        // The TL never approves; an attacker posts a plaintext complete with
        // from_pubkey copied from the real TL (it is public).
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        // Attacker (any client) posts a forged complete addressed to the user.
        const { send_payload: sp } = await import('../src/core/slack/transport.js')
        await sp({
            client: ws.client('U_EVIL'), channel_id: CHANNEL,
            recipient_slack_user_id: 'U_USER',
            kind: MESSAGE_KINDS.complete,
            payload: { email: 'newbie@test.com', from_pubkey: tl_self.pubkey, status: 'complete' },
        })

        const result = await onboard_provision_poll(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self_user_id: 'U_USER',
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        })
        expect(result.complete).toBe(false)
        expect(result.warnings.length).toBeGreaterThan(0)
    })
})

describe('import idempotency', () => {
    it('import_secret_batch can run twice without error or duplication', async () => {
        // Build a secret_batch payload directly via approve, then re-import.
        await onboard_invite(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', project: 'myapp:*:*', name: 'newbie@host',
            channel_id: CHANNEL, self: tl_self,
        })
        await onboard_join(user_storage, ws.client('U_USER'), {
            channel_id: CHANNEL, self: user_self, tl_slack_user_id: 'U_TL',
        })
        await onboard_poll(tl_storage, ws.client('U_TL'), { channel_id: CHANNEL, self_user_id: 'U_TL' })
        const row0 = await tl_storage.onboarding_get('newbie@test.com')
        await onboard_approve(tl_storage, ws.client('U_TL'), {
            email: 'newbie@test.com', verified: true, fingerprint: row0.fingerprint,
            channel_id: CHANNEL, self: tl_self, sender_private_key: tl_kp.secretKey,
        })

        const got = await collect(poll_envelopes({
            client: ws.client('U_USER'), channel_id: CHANNEL, self_user_id: 'U_USER',
        }))
        const batch = got.find(g => g.kind === MESSAGE_KINDS.secret_batch).payload
        const opts = {
            receiver_private_key: user_kp.secretKey,
            trusted_pubkey: tl_self.pubkey,
        }
        const n1 = await import_secret_batch(user_storage, batch, opts)
        const n2 = await import_secret_batch(user_storage, batch, opts)
        expect(n1).toBe(2)
        expect(n2).toBe(2)
        expect(await user_storage.fetch_secrets()).toHaveLength(2)
    })
})

describe('tl trust context (user side)', () => {
    it('round-trips the verified TL fingerprint + ids through the vault kv', async () => {
        await set_tl_trust(user_storage, {
            user_id: 'U_TL',
            pubkey: tl_self.pubkey,
            fingerprint: compute_fingerprint(tl_self),
            project: 'myapp:*:*',
        })
        const trust = await get_tl_trust(user_storage)
        expect(trust.tl_user_id).toBe('U_TL')
        expect(trust.tl_pubkey).toBe(tl_self.pubkey)
        expect(trust.tl_fingerprint).toBe(compute_fingerprint(tl_self))
        expect(trust.project).toBe('myapp:*:*')
    })

    it('returns nulls when nothing is stored', async () => {
        const trust = await get_tl_trust(user_storage)
        expect(trust.tl_fingerprint).toBeNull()
    })
})

describe('expire_stale_onboarding (Phase 8)', () => {
    it('expires stale invited/introduced rows but leaves terminal ones', async () => {
        await tl_storage.onboarding_create({ email: 'a@test.com', state: 'invited' })
        await tl_storage.onboarding_create({ email: 'b@test.com', state: 'introduced' })
        await tl_storage.onboarding_create({ email: 'c@test.com', state: 'complete' })

        const now_row = await tl_storage.onboarding_get('a@test.com')
        const future = now_row.updated_at + 10_000
        const n = await expire_stale_onboarding(tl_storage, { ttl_seconds: 1, now: future })
        expect(n).toBe(2)

        expect((await tl_storage.onboarding_get('a@test.com')).state).toBe(ONBOARDING_STATES.expired)
        expect((await tl_storage.onboarding_get('b@test.com')).state).toBe(ONBOARDING_STATES.expired)
        expect((await tl_storage.onboarding_get('c@test.com')).state).toBe(ONBOARDING_STATES.complete)
    })
})

// A SqliteStorage over a throwaway vault keyed by alice's keypair, used to
// import the broadcast user_list as "alice" (resolved question 1).
let alice_storage
beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-onb-alicev-'))
    generate_symmetric_key(dir)
    fs.writeFileSync(path.join(dir, 'private.key'), encode_key(alice_kp.secretKey), 'utf-8')
    fs.writeFileSync(path.join(dir, 'public.key'), encode_key(alice_kp.publicKey), 'utf-8')
    await run_migrations(dir, 'alice@host', 'alice@test.com', encode_key(alice_kp.publicKey))
    alice_storage = new SqliteStorage('seeqrets.db', dir)
    alice_storage._cleanup_dir = dir
})
afterEach(() => {
    if (alice_storage?._cleanup_dir) {
        try { fs.rmSync(alice_storage._cleanup_dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
})
