/**
 * Onboarding orchestration primitives.
 *
 * These compose the existing pieces -- the Slack transport (typed
 * envelopes), the json-crypt / user-list serializers, and the onboarding
 * state table -- into the 16-step flow described in
 * documentation/completed/onboarding/index.md. They are deliberately dependency-
 * injected (storage + Slack client + identities passed in) so the GUI,
 * the CLI, and the test suite all drive the *same* code with a real or a
 * mock client.
 *
 * The trust model (plan.md "Trust model") lives here:
 *   - The team lead approves a user only after the captured fingerprint is
 *     verified out-of-band -- re-validated in `onboard_approve`, not just
 *     in the GUI checkbox.
 *   - The new user imports teammate keys and secrets only when the sender
 *     pubkey that rode in the envelope hashes to the TL fingerprint the
 *     user verified on the voice call -- `import_user_list` /
 *     `import_secret_batch` enforce this. A key that merely arrived over
 *     Slack is never trusted on Slack's say-so.
 */

import { timingSafeEqual } from 'crypto'
import {
    decode_key,
    fingerprint as nacl_fingerprint,
    asymmetric_encrypt,
    asymmetric_decrypt,
} from './crypto/nacl.js'
import { Secret } from './models/secret.js'
import { User } from './models/user.js'
import { FilterSpec } from './filter.js'
import { compute_fingerprint } from './slack/identity.js'
import {
    send_payload,
    poll_envelopes,
    delete_thread,
} from './slack/transport.js'
import { MESSAGE_KINDS } from './serializers/envelope.js'
import { JsonCryptSerializer } from './serializers/json-crypt.js'
import { UserListSerializer } from './serializers/user-list.js'
import { trace } from './trace.js'
import {
    slack_config_get, slack_config_set, slack_config_delete,
} from './slack/config.js'

/**
 * Vault-side (kv) keys for the new user's trust context: the team lead's
 * Slack id, pubkey, and the fingerprint the user verified out-of-band.
 * Fernet-wrapped exactly like the slack.* config.
 */
export const ONBOARD_KEYS = {
    tl_user_id: 'onboard.tl_user_id',
    tl_pubkey: 'onboard.tl_pubkey',
    tl_fingerprint: 'onboard.tl_fingerprint',
    project: 'onboard.project',
    wizard: 'onboard.wizard',
    introduced: 'onboard.introduced',
}

/** Plaintext a `complete` ack's NaCl-Box proof must decrypt to. */
const COMPLETE_PROOF = 'jseeqret-onboard-complete'

export const DEFAULT_DOWNLOAD_URL =
    'https://github.com/thebjorn/jseeqret/releases/latest'

/** Default invite/introduction time-to-live before a row expires. */
export const DEFAULT_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60

export const ONBOARDING_STATES = {
    invited: 'invited',
    introduced: 'introduced',
    approved: 'approved',
    provisioned: 'provisioned',
    complete: 'complete',
    expired: 'expired',
}

/** The forward progression a healthy onboarding follows. */
export const STATE_ORDER = [
    ONBOARDING_STATES.invited,
    ONBOARDING_STATES.introduced,
    ONBOARDING_STATES.approved,
    ONBOARDING_STATES.provisioned,
    ONBOARDING_STATES.complete,
]

function _now() {
    return Math.floor(Date.now() / 1000)
}

/**
 * Fingerprint of a base64-encoded NaCl public key. Same digest as
 * `slack/identity.compute_fingerprint(user)`, so the value the user reads
 * on the voice call lines up with what arrives over the wire.
 * @param {string} pubkey_b64
 * @returns {string}
 */
export function pubkey_fingerprint(pubkey_b64) {
    return nacl_fingerprint(Buffer.from(decode_key(pubkey_b64)))
}

/**
 * Constant-time full-public-key equality (decoded 32-byte compare). This
 * -- not the 5-char fingerprint -- is the real authentication primitive.
 * The fingerprint is only 20 bits, so an attacker who controls both the
 * ciphertext and the self-reported `from_pubkey` could grind a colliding
 * key offline. We therefore authenticate against the full out-of-band-
 * anchored TL pubkey and decrypt with IT, so NaCl Box requires the real
 * TL private key.
 * @param {string} a_b64
 * @param {string} b_b64
 * @returns {boolean}
 */
export function pubkeys_equal(a_b64, b_b64) {
    if (!a_b64 || !b_b64) return false
    const a = Buffer.from(decode_key(a_b64))
    const b = Buffer.from(decode_key(b_b64))
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

/**
 * Does the sender pubkey hash to the out-of-band-verified fingerprint?
 * Used only for the human OOB display/confirmation, never as the import
 * authentication gate (see {@link pubkeys_equal}).
 * @param {string} pubkey_b64
 * @param {string} trusted_fingerprint
 * @returns {boolean}
 */
export function is_trusted_sender(pubkey_b64, trusted_fingerprint) {
    return !!trusted_fingerprint
        && pubkey_fingerprint(pubkey_b64) === trusted_fingerprint
}

function _require_trusted_pubkey(trusted_pubkey, what) {
    if (!trusted_pubkey) {
        throw new Error(
            `refusing to import ${what}: no verified team-lead key on file.`
            + ' Run join and verify the fingerprint out-of-band first.'
        )
    }
}

// ---- Team-lead side -------------------------------------------------------

/**
 * Step 1-4: record an invited row and post an invite envelope addressed to
 * the new user, carrying the download link and the TL's own identity so the
 * user can verify the TL fingerprint on the voice call.
 *
 * @param {import('./sqlite-storage.js').SqliteStorage} storage
 * @param {import('./slack/client.js').SlackClient} client
 * @param {object} opts
 * @param {string} opts.email - invitee email (addresses the vault)
 * @param {string} opts.project - FilterSpec for the secrets to send
 * @param {string} [opts.name] - optional display username
 * @param {string} opts.channel_id
 * @param {import('./models/user.js').User} opts.self - the TL's own user
 * @param {string} [opts.download_url]
 * @returns {Promise<{slack_user_id: string, file_id: string}>}
 */
export async function onboard_invite(storage, client, opts) {
    const {
        email, project, name = null, channel_id, self,
        download_url = DEFAULT_DOWNLOAD_URL,
    } = opts

    // Re-inviting must not clobber a row that already captured the user's
    // fingerprint/pubkey (introduced/approved/provisioned) -- INSERT OR
    // REPLACE would wipe it. But an `invited` row has nothing captured yet,
    // so resending to it (e.g. the first invite was missed) is safe and
    // expected; `complete`/`expired` rows are terminal and may be restarted.
    const existing = await storage.onboarding_get(email)
    const RESENDABLE = new Set([
        ONBOARDING_STATES.invited,
        ONBOARDING_STATES.complete,
        ONBOARDING_STATES.expired,
    ])
    if (existing && !RESENDABLE.has(existing.state)) {
        throw new Error(
            `onboarding already in progress for ${email}`
            + ` (state: ${existing.state}). Let it complete or expire first.`
        )
    }

    const hit = await client.lookup_user_by_email(email)
    if (!hit) {
        throw new Error(
            `could not find a Slack user for ${email} in the workspace.`
            + ' Ask them to join the workspace first, then re-invite.'
        )
    }

    // `name` is the human display name; `username` stays null until the
    // introduction delivers the vault's machine identity (user@host).
    await storage.onboarding_create({
        email,
        name,
        slack_user_id: hit.id,
        project_filter: project,
        state: ONBOARDING_STATES.invited,
    })

    const sent = await send_payload({
        client,
        channel_id,
        recipient_slack_user_id: hit.id,
        kind: MESSAGE_KINDS.invite,
        payload: {
            email,
            project,
            download_url,
            tl_username: self.username,
            tl_email: self.email,
            tl_pubkey: self.pubkey,
            tl_fingerprint: compute_fingerprint(self),
        },
    })

    return { slack_user_id: hit.id, file_id: sent.file_id }
}

/**
 * Step 8-9: poll for introduction envelopes. Matching, still-open rows are
 * promoted to `introduced` with the fingerprint and pubkey captured locally
 * (so approval survives Slack retention), then the introduction thread is
 * deleted. Introductions with no matching invite are returned as
 * `expected: false` events (surfaced as a warning) but never persisted.
 *
 * @returns {Promise<{events: Array<object>, highest_ts: string}>}
 */
export async function onboard_poll(storage, client, opts) {
    const { channel_id, self_user_id, oldest_ts = '0' } = opts
    const events = []
    let highest_ts = oldest_ts

    for await (const env of poll_envelopes({
        client, channel_id, self_user_id, oldest_ts,
    })) {
        if (Number(env.file_ts) > Number(highest_ts)) highest_ts = env.file_ts
        if (env.kind !== MESSAGE_KINDS.introduction) continue

        const { email, username, pubkey } = env.payload
        const fp = pubkey_fingerprint(pubkey)
        const row = await storage.onboarding_get(email)
        const open = row && (
            row.state === ONBOARDING_STATES.invited
            || row.state === ONBOARDING_STATES.introduced
        )

        if (open) {
            // Durably capture BEFORE deleting, so a delete failure never
            // loses the fingerprint/pubkey we need to approve.
            await storage.onboarding_update(email, {
                username: username || row.username,
                slack_user_id: env.sender_user_id,
                pubkey,
                fingerprint: fp,
                state: ONBOARDING_STATES.introduced,
            })
            try {
                await delete_thread({
                    client, channel_id,
                    file_id: env.file_id, reply_ts: env.reply_ts,
                })
            } catch { /* best-effort; row is already captured */ }
            events.push({ email, fingerprint: fp, expected: true })
        } else {
            events.push({
                email, fingerprint: fp, expected: false,
                slack_user_id: env.sender_user_id,
            })
        }
    }

    return { events, highest_ts }
}

/**
 * Steps 10-16: the security heart. Re-validates the out-of-band
 * verification, adds the new user, ships the teammate list and the
 * project-scoped secrets, broadcasts the newcomer to existing teammates,
 * and posts the completion ack.
 *
 * @param {object} opts
 * @param {string} opts.email
 * @param {boolean} opts.verified - the "verified on a voice call" flag
 * @param {string} opts.fingerprint - the fingerprint the TL typed back
 * @param {string} opts.channel_id
 * @param {import('./models/user.js').User} opts.self - the TL's own user
 * @param {Uint8Array} opts.sender_private_key - the TL's NaCl private key
 * @returns {Promise<{email: string, users_sent: number, secrets_sent: number, broadcasts: number}>}
 */
export async function onboard_approve(storage, client, opts) {
    const {
        email, verified, fingerprint, channel_id, self, sender_private_key,
    } = opts

    const row = await storage.onboarding_get(email)
    if (!row) {
        throw new Error(`no onboarding in progress for ${email}`)
    }
    // Resumable: a mid-sequence failure leaves the row at approved/
    // provisioned; re-entry from those states re-runs the remaining
    // (idempotent) sends rather than dead-ending.
    const APPROVABLE = [
        ONBOARDING_STATES.introduced,
        ONBOARDING_STATES.approved,
        ONBOARDING_STATES.provisioned,
    ]
    if (!APPROVABLE.includes(row.state)) {
        throw new Error(
            `cannot approve ${email}: state is '${row.state}',`
            + ` expected one of ${APPROVABLE.join('/')}`
        )
    }

    // The gate, enforced in core (the GUI checkbox is UX, not authority).
    if (verified !== true) {
        throw new Error(
            'refusing to approve: the fingerprint was not verified'
            + ' out-of-band (verification flag is not set).'
        )
    }
    if (!fingerprint || fingerprint !== row.fingerprint) {
        throw new Error(
            `refusing to approve: typed fingerprint does not match the`
            + ` captured fingerprint ${row.fingerprint}.`
        )
    }

    const new_user = new User(row.username, email, row.pubkey, {
        name: row.name || null,
    })
    // Idempotent: a retry must not throw on the unique-username constraint.
    const existing = await storage.fetch_user(row.username)
    if (!existing) {
        await storage.add_user(new_user)
    }
    // Record the verified binding so future `send`s work without re-linking.
    // Derive a handle when the intro didn't carry one (matches `slack link`);
    // the display name beats the machine identity's account part.
    const handle = row.slack_handle || (row.name || row.username).split('@')[0]
    await storage.update_user_slack(row.username, {
        slack_handle: handle,
        slack_key_fingerprint: row.fingerprint,
        slack_verified_at: _now(),
    })
    await storage.onboarding_set_state(email, ONBOARDING_STATES.approved)

    // Steps 12-13: send the full teammate list to the new user.
    const all_users = await storage.fetch_users()
    const teammates = all_users.filter(u => u.username !== new_user.username)
    await _send_user_list(client, channel_id, row.slack_user_id, {
        self, sender_private_key, receiver: new_user, users: teammates,
    })
    await storage.onboarding_set_state(email, ONBOARDING_STATES.provisioned)

    // Resolved question 1: broadcast the newcomer to existing teammates so
    // they can send to them without a manual re-link. Best-effort: skip
    // teammates we cannot resolve to a Slack user.
    let broadcasts = 0
    for (const mate of teammates) {
        if (mate.username === self.username) continue
        if (!mate.email) continue
        const hit = await client.lookup_user_by_email(mate.email)
        if (!hit) continue
        await _send_user_list(client, channel_id, hit.id, {
            self, sender_private_key, receiver: mate, users: [new_user],
        })
        broadcasts += 1
    }

    // Steps 14-15: send the project-scoped secrets.
    const filter = new FilterSpec(row.project_filter || '*:*:*')
    const secrets = await storage.fetch_secrets(filter.to_filter_dict())
    const exporter = new JsonCryptSerializer({
        sender: self, receiver: new_user, sender_private_key,
    })
    const batch = JSON.parse(exporter.dumps(secrets))
    batch.from_pubkey = self.pubkey
    await send_payload({
        client, channel_id, recipient_slack_user_id: row.slack_user_id,
        kind: MESSAGE_KINDS.secret_batch, payload: batch,
    })

    // Step 16: completion ack, carrying a NaCl-Box proof of TL authorship
    // so a forged plaintext `complete` cannot strand the new user.
    await send_payload({
        client, channel_id, recipient_slack_user_id: row.slack_user_id,
        kind: MESSAGE_KINDS.complete,
        payload: {
            email,
            from_pubkey: self.pubkey,
            status: 'complete',
            proof: asymmetric_encrypt(
                COMPLETE_PROOF, sender_private_key, new_user.public_key,
            ),
        },
    })
    await storage.onboarding_set_state(email, ONBOARDING_STATES.complete)

    return {
        email,
        users_sent: teammates.length,
        secrets_sent: secrets.length,
        broadcasts,
    }
}

async function _send_user_list(client, channel_id, recipient_slack_user_id, opts) {
    const { self, sender_private_key, receiver, users } = opts
    const exporter = new UserListSerializer({
        sender: self, receiver, sender_private_key,
    })
    const payload = JSON.parse(exporter.dumps(users))
    payload.from_pubkey = self.pubkey
    return send_payload({
        client, channel_id, recipient_slack_user_id,
        kind: MESSAGE_KINDS.user_list, payload,
    })
}

// ---- New-user side --------------------------------------------------------

/**
 * Steps 5-7 (read side): poll for the invite addressed to me. Returns the
 * invite details (including the TL's Slack id and fingerprint to verify on
 * the voice call) or null if none is waiting. The invite is NOT trusted
 * here -- the user must confirm the fingerprint out-of-band.
 *
 * @returns {Promise<object|null>}
 */
export async function onboard_receive_invite(storage, client, opts) {
    const { channel_id, self_user_id, oldest_ts = '0' } = opts
    let latest = null

    for await (const env of poll_envelopes({
        client, channel_id, self_user_id, oldest_ts,
    })) {
        if (env.kind !== MESSAGE_KINDS.invite) continue
        latest = {
            ...env.payload,
            // RECOMPUTE the fingerprint from the pubkey we will actually
            // anchor trust to -- never display the invite's self-reported
            // value. The user verifies THIS against the voice call, binding
            // the (Slack-delivered) pubkey to the out-of-band fingerprint.
            tl_fingerprint: env.payload.tl_pubkey
                ? pubkey_fingerprint(env.payload.tl_pubkey)
                : null,
            tl_slack_user_id: env.sender_user_id,
            file_id: env.file_id,
            reply_ts: env.reply_ts,
            file_ts: env.file_ts,
        }
    }

    return latest
}

/**
 * Step 7 (write side): post the introduction (pubkey + fingerprint) to the
 * team lead.
 *
 * @param {object} opts
 * @param {string} opts.channel_id
 * @param {import('./models/user.js').User} opts.self - the user's own user
 * @param {string} opts.tl_slack_user_id
 * @param {string} [opts.email] - the email the TL invited under. The TL
 *        matches the introduction to the invite by this email, so it must
 *        be the invited address, NOT the new vault's `user@host` placeholder
 *        self.email. Falls back to self.email only when no invite email is
 *        available (legacy/manual flows).
 * @returns {Promise<{file_id: string}>}
 */
export async function onboard_join(storage, client, opts) {
    const { channel_id, self, tl_slack_user_id, email = null } = opts
    const sent = await send_payload({
        client, channel_id, recipient_slack_user_id: tl_slack_user_id,
        kind: MESSAGE_KINDS.introduction,
        payload: {
            email: email || self.email,
            username: self.username,
            pubkey: self.pubkey,
            fingerprint: compute_fingerprint(self),
        },
    })
    return { file_id: sent.file_id }
}

/**
 * Idempotent introduction: send at most once per invited email, recorded
 * in the vault kv. The introduction only publishes the user's OWN pubkey
 * and fingerprint (public by definition), so it is safe to send BEFORE
 * the out-of-band verification -- the GUI auto-sends it as soon as the
 * invite is found, and the voice-call gate still guards `set_tl_trust`
 * (imports cannot authenticate without it). `force` re-sends for the
 * recovery path (introduction lost to Slack retention).
 *
 * @param {object} opts - onboard_join opts plus {boolean} [opts.force]
 * @returns {Promise<{sent: boolean, email: string, file_id?: string}>}
 */
export async function onboard_introduce(storage, client, opts) {
    const {
        channel_id, self, tl_slack_user_id, email = null, force = false,
    } = opts
    const target = email || self.email

    if (!force) {
        const already = await slack_config_get(storage, ONBOARD_KEYS.introduced)
        if (already && already.email === target) {
            return { sent: false, email: target }
        }
    }

    const r = await onboard_join(storage, client, {
        channel_id, self, tl_slack_user_id, email: target,
    })
    await slack_config_set(storage, ONBOARD_KEYS.introduced, {
        email: target,
        at: _now(),
    })
    return { sent: true, email: target, file_id: r.file_id }
}

/**
 * Import a `user_list` payload. Authenticated by decrypting with the
 * out-of-band-verified TL pubkey (NOT the self-reported `from_pubkey`):
 * NaCl Box.open then requires the real TL private key, so a forged sender
 * -- even one whose 5-char fingerprint collides -- is rejected.
 * Idempotent: existing usernames are skipped.
 *
 * @returns {Promise<Array<import('./models/user.js').User>>} imported users
 */
export async function import_user_list(storage, payload, opts) {
    const { receiver_private_key, trusted_pubkey } = opts
    _require_trusted_pubkey(trusted_pubkey, 'user_list')

    const sender = new User('tl', '', trusted_pubkey)
    const serializer = new UserListSerializer({ sender, receiver_private_key })
    const users = serializer.load(JSON.stringify(payload))

    const imported = []
    for (const user of users) {
        const existing = await storage.fetch_user(user.username)
        if (existing) continue
        await storage.add_user(user)
        imported.push(user)
    }
    return imported
}

/**
 * Import a `secret_batch` payload, authenticated with the OOB-verified TL
 * pubkey (see {@link import_user_list}). Idempotent: secrets are upserted by
 * (app, env, key).
 *
 * @returns {Promise<number>} number of secrets actually imported
 */
export async function import_secret_batch(storage, payload, opts) {
    const { receiver_private_key, trusted_pubkey } = opts
    _require_trusted_pubkey(trusted_pubkey, 'secret_batch')

    const sender_pk = decode_key(trusted_pubkey)
    const records = payload.secrets || []
    let imported = 0

    for (const s of records) {
        const plaintext = Secret.decrypt_value(
            s.value, sender_pk, receiver_private_key,
        )
        const secret = new Secret({
            app: s.app,
            env: s.env,
            key: s.key,
            type: s.type || 'str',
            plaintext_value: plaintext,
            vault_dir: storage.vault_dir,
        })
        await storage.upsert_secret(secret)
        imported += 1
    }
    return imported
}

/**
 * Verify a `complete` ack is genuinely from the TL: its proof must
 * NaCl-Box-decrypt (with the OOB-verified TL pubkey as sender) to the
 * expected plaintext. A plaintext-only complete (no proof) is rejected,
 * so a forged complete cannot strand the user's wizard.
 */
function _verify_complete(payload, receiver_private_key, trusted_pubkey) {
    if (!trusted_pubkey || !payload || !payload.proof) return false
    try {
        const txt = asymmetric_decrypt(
            payload.proof, receiver_private_key, decode_key(trusted_pubkey),
        )
        return txt === COMPLETE_PROOF
    } catch {
        return false
    }
}

/**
 * Steps 13-16 (user side): poll for the teammate list, scoped secrets, and
 * completion ack, importing each (authenticated against the OOB-verified TL
 * pubkey) and deleting the thread after a successful import.
 *
 * A single untrusted / malformed envelope is skipped (recorded in
 * `warnings`) rather than aborting the whole poll, so a forged blob injected
 * among genuine TL envelopes cannot deny provisioning. Untrusted envelopes
 * are NOT deleted.
 *
 * @returns {Promise<{imported_users: number, imported_secrets: number, complete: boolean, highest_ts: string, warnings: Array<object>}>}
 */
export async function onboard_provision_poll(storage, client, opts) {
    const {
        channel_id, self_user_id, receiver_private_key,
        trusted_pubkey, oldest_ts = '0',
    } = opts

    let imported_users = 0
    let imported_secrets = 0
    let complete = false
    let highest_ts = oldest_ts
    const warnings = []

    for await (const env of poll_envelopes({
        client, channel_id, self_user_id, oldest_ts,
    })) {
        if (Number(env.file_ts) > Number(highest_ts)) highest_ts = env.file_ts

        // Forward-secrecy cleanup is best-effort: a plain member cannot
        // delete the TL's messages (`cant_delete_message` -- only admins
        // and the author can), so a failed delete must NOT surface as an
        // import warning. The envelope lingers until Slack retention
        // reaps it; imports stay idempotent if it is seen again.
        const drop = async () => {
            try {
                await delete_thread({
                    client, channel_id,
                    file_id: env.file_id, reply_ts: env.reply_ts,
                })
            } catch (e) {
                trace(`provision cleanup of ${env.file_id} failed: ${e.message}`)
            }
        }

        try {
            if (env.kind === MESSAGE_KINDS.user_list) {
                const users = await import_user_list(storage, env.payload, {
                    receiver_private_key, trusted_pubkey,
                })
                imported_users += users.length
                await drop()
            } else if (env.kind === MESSAGE_KINDS.secret_batch) {
                imported_secrets += await import_secret_batch(storage, env.payload, {
                    receiver_private_key, trusted_pubkey,
                })
                await drop()
            } else if (env.kind === MESSAGE_KINDS.complete) {
                if (!_verify_complete(env.payload, receiver_private_key, trusted_pubkey)) {
                    throw new Error('unauthenticated complete ack')
                }
                complete = true
                await drop()
            }
        } catch (e) {
            warnings.push({ kind: env.kind, error: e.message })
        }
    }

    return { imported_users, imported_secrets, complete, highest_ts, warnings }
}

/**
 * Persist the new user's trust context after the user has confirmed the TL
 * fingerprint out-of-band. `fingerprint` here is the verified value the
 * user typed (or confirmed); it becomes the gate for later imports.
 */
export async function set_tl_trust(storage, { user_id, pubkey, fingerprint, project }) {
    if (user_id != null) await slack_config_set(storage, ONBOARD_KEYS.tl_user_id, user_id)
    if (pubkey != null) await slack_config_set(storage, ONBOARD_KEYS.tl_pubkey, pubkey)
    if (fingerprint != null) await slack_config_set(storage, ONBOARD_KEYS.tl_fingerprint, fingerprint)
    if (project != null) await slack_config_set(storage, ONBOARD_KEYS.project, project)
}

/**
 * Read back the stored trust context (any field may be null).
 * @returns {Promise<{tl_user_id: string|null, tl_pubkey: string|null, tl_fingerprint: string|null, project: string|null}>}
 */
export async function get_tl_trust(storage) {
    return {
        tl_user_id: await slack_config_get(storage, ONBOARD_KEYS.tl_user_id),
        tl_pubkey: await slack_config_get(storage, ONBOARD_KEYS.tl_pubkey),
        tl_fingerprint: await slack_config_get(storage, ONBOARD_KEYS.tl_fingerprint),
        project: await slack_config_get(storage, ONBOARD_KEYS.project),
    }
}

/**
 * First-run wizard lifecycle flag. `initialized` (vault dir + db exist)
 * flips true the moment the wizard's create step finishes, so the GUI
 * cannot use it to decide whether onboarding is still in progress -- it
 * would unmount the wizard before the Slack/introduce steps run. This
 * flag is set when the wizard creates the vault and cleared when the
 * wizard completes (or the user explicitly skips it).
 *
 * @returns {Promise<string|null>} 'active' while the wizard owns the UI
 */
export async function get_wizard_state(storage) {
    return slack_config_get(storage, ONBOARD_KEYS.wizard)
}

/**
 * Set or clear the wizard lifecycle flag. Pass null to clear.
 * @param {string|null} state
 */
export async function set_wizard_state(storage, state) {
    if (state == null) {
        await slack_config_delete(storage, ONBOARD_KEYS.wizard)
    } else {
        await slack_config_set(storage, ONBOARD_KEYS.wizard, state)
    }
}

// ---- Hardening ------------------------------------------------------------

/**
 * Time out stale `invited`/`introduced` rows to `expired` so the TL is not
 * asked to approve a ghost. Terminal rows are left untouched.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttl_seconds]
 * @param {number} [opts.now] - unix seconds (injectable for tests)
 * @returns {Promise<number>} number of rows expired
 */
export async function expire_stale_onboarding(storage, opts = {}) {
    const ttl_seconds = opts.ttl_seconds ?? DEFAULT_INVITE_TTL_SECONDS
    const now = opts.now ?? _now()
    const cutoff = now - ttl_seconds

    const rows = await storage.onboarding_list()
    let expired = 0

    for (const row of rows) {
        const open = row.state === ONBOARDING_STATES.invited
            || row.state === ONBOARDING_STATES.introduced
        if (open && row.updated_at < cutoff) {
            await storage.onboarding_set_state(row.email, ONBOARDING_STATES.expired)
            expired += 1
        }
    }
    return expired
}
