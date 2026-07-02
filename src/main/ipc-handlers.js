import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { SqliteStorage } from '../core/sqlite-storage.js'

const require = createRequire(import.meta.url)
const { version: pkg_version } = require('../../package.json')
import { FilterSpec } from '../core/filter.js'
import { Secret } from '../core/models/secret.js'
import { User } from '../core/models/user.js'
import {
    is_initialized, get_seeqret_dir, current_user, qualified_user,
} from '../core/vault.js'
import { fetch_self } from '../core/user-resolve.js'
import {
    load_private_key_str, load_public_key_str,
    generate_symmetric_key, generate_and_save_key_pair,
} from '../core/crypto/utils.js'
import { decode_key, encode_key } from '../core/crypto/nacl.js'
import { get_serializer, list_serializers } from '../core/serializers/index.js'
import {
    registry_list, registry_add, registry_remove,
    registry_use, registry_default, registry_resolve,
} from '../core/vault-registry.js'
import { run_migrations, upgrade_db } from '../core/migrations.js'
import { harden_vault_windows } from '../core/fileutils.js'
import { SlackClient } from '../core/slack/client.js'
import {
    SLACK_KEYS, slack_config_get, slack_config_set,
    slack_config_snapshot, slack_config_clear_all,
} from '../core/slack/config.js'
import {
    slack_oauth_login, slack_set_channel,
    slack_session_status, slack_attest_mfa, assert_slack_ready,
} from '../core/slack/session.js'
import {
    bind_slack_handle, compute_fingerprint, require_verified_binding,
} from '../core/slack/identity.js'
import { send_blob } from '../core/slack/transport.js'
import { transport_selftest } from '../core/slack/selftest.js'
import {
    onboard_invite, onboard_poll, onboard_approve, onboard_introduce,
    onboard_receive_invite, onboard_provision_poll,
    onboard_send_received_ack, inbox_introductions, accept_introduction,
    expire_stale_onboarding, set_tl_trust, get_tl_trust,
    get_wizard_state, set_wizard_state,
} from '../core/onboarding.js'
import { log_info, log_error, get_log_dir } from './logger.js'

/**
 * Resolve vault dir from registry default first, falling back to
 * get_seeqret_dir() (which prioritizes env vars).
 */
function get_active_vault_dir() {
    const default_name = registry_default()
    if (default_name) {
        const resolved = registry_resolve(default_name)
        if (resolved) return resolved
    }
    return get_seeqret_dir()
}

function get_storage() {
    return new SqliteStorage('seeqrets.db', get_active_vault_dir())
}

/**
 * Bring a vault's schema up to date the first time the main process opens
 * it this session. Vaults created before a migration landed (e.g. the v004
 * onboarding table) are otherwise never upgraded by the GUI -- only CLI
 * `slack login` ran `upgrade_db`. We cache the in-flight promise per vault
 * so concurrent handlers (onboard:list + onboard:poll fire together on
 * load) don't race two read-modify-write upgrades against the same file.
 * @param {string} vault_dir
 * @returns {Promise<void>}
 */
const _migration_cache = new Map()
function ensure_migrated(vault_dir) {
    if (!vault_dir) return Promise.resolve()
    if (!fs.existsSync(path.join(vault_dir, 'seeqrets.db'))) return Promise.resolve()
    if (!_migration_cache.has(vault_dir)) {
        _migration_cache.set(
            vault_dir,
            upgrade_db(vault_dir).catch((e) => {
                _migration_cache.delete(vault_dir)   // allow a later retry
                throw e
            })
        )
    }
    return _migration_cache.get(vault_dir)
}

/**
 * Migrate the currently-active vault. Called once at app startup (before
 * the renderer can invoke a handler) so existing vaults gain new tables.
 * Best-effort: a failure is logged, not fatal.
 */
export async function ensure_active_vault_migrated() {
    let vault_dir
    try {
        vault_dir = get_active_vault_dir()
    } catch {
        // Fresh machine: no env var and no registry yet -- nothing to
        // migrate, and not an error (the first-run wizard handles it).
        return
    }
    try {
        await ensure_migrated(vault_dir)
    } catch (e) {
        log_error('vault migration on startup failed:', e)
    }
}

export function register_ipc_handlers() {
    // Every handler registers through this wrapper so any failure lands
    // in the log file with its channel name before propagating to the
    // renderer -- a packaged app has no console to read.
    function handle(channel, fn) {
        ipcMain.handle(channel, async (event, ...args) => {
            try {
                return await fn(event, ...args)
            } catch (e) {
                log_error(`ipc ${channel}:`, e)
                throw e
            }
        })
    }

    handle('vault:status', async () => {
        let vault_dir
        let initialized = false
        try {
            vault_dir = get_active_vault_dir()
            initialized = fs.existsSync(vault_dir)
                && fs.existsSync(path.join(vault_dir, 'seeqrets.db'))
        } catch {
            vault_dir = null
        }
        // The first-run wizard cannot key off `initialized` alone -- it
        // flips true the moment the wizard's create step finishes, which
        // would unmount the wizard before Slack onboarding runs. The
        // wizard sets this flag at creation and clears it on finish/skip.
        let onboarding_active = false
        if (initialized) {
            try {
                const state = await get_wizard_state(get_storage())
                onboarding_active = state === 'active'
            } catch { /* pre-kv vault or unreadable key: not onboarding */ }
        }
        return {
            initialized,
            onboarding_active,
            vaultDir: initialized ? vault_dir : null,
            currentUser: current_user(),
            version: pkg_version,
            activeVault: registry_default(),
        }
    })

    handle('secrets:list', async (_event, filter = '*') => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        return secrets.map(s => s.to_plaintext_dict())
    })

    handle('secrets:get', async (_event, filter) => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        if (secrets.length === 0) throw new Error(`No secrets found for ${filter}`)
        if (secrets.length > 1) throw new Error(`Found ${secrets.length} secrets for ${filter}`)
        return secrets[0].get_value()
    })

    handle('secrets:add', async (_event, { app, env, key, value, type }) => {
        const storage = get_storage()
        const vault_dir = get_active_vault_dir()
        const secret = new Secret({ app, env, key, plaintext_value: value, type: type || 'str', vault_dir })
        await storage.add_secret(secret)
        return { ok: true }
    })

    handle('secrets:update', async (_event, { app, env, key, value }) => {
        const storage = get_storage()
        const fspec = new FilterSpec(`${app}:${env}:${key}`)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        if (secrets.length === 0) throw new Error('Secret not found')
        secrets[0].set_value(value)
        await storage.update_secret(secrets[0])
        return { ok: true }
    })

    handle('secrets:remove', async (_event, filter) => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        await storage.remove_secrets(fspec.to_filter_dict())
        return { ok: true }
    })

    handle('users:list', async () => {
        const storage = get_storage()
        const [users, admin] = await Promise.all([
            storage.fetch_users(),
            storage.fetch_admin(),
        ])
        return users.map(u => ({
            ...u.toJSON(),
            fingerprint: compute_fingerprint(u),
            is_owner: !!admin && u.username === admin.username,
        }))
    })

    handle('users:add', async (_event, { username, email, pubkey, name }) => {
        const storage = get_storage()
        const user = new User(username, email, pubkey, { name: name || null })
        await storage.add_user(user)
        return { ok: true }
    })

    handle('users:update', async (_event, { username, name, email, pubkey }) => {
        const storage = get_storage()
        const user = await storage.fetch_user(username)
        if (!user) throw new Error(`User '${username}' not found in vault.`)
        // The owner's pubkey mirrors the vault's key files -- re-keying
        // the row alone would desync every export this vault produces.
        const admin = await storage.fetch_admin()
        const is_owner = !!admin && admin.username === username
        if (is_owner && pubkey !== undefined && pubkey !== admin.pubkey) {
            throw new Error(
                'Cannot change the vault owner\'s public key: it is bound'
                + ' to the vault\'s key files.'
            )
        }
        const fields = {}
        if (name !== undefined) fields.name = name || null
        if (email !== undefined) fields.email = email
        if (pubkey !== undefined) fields.pubkey = pubkey
        await storage.update_user(username, fields)
        return { ok: true }
    })

    handle('users:remove', async (_event, { username }) => {
        const storage = get_storage()
        const admin = await storage.fetch_admin()
        if (admin && admin.username === username) {
            throw new Error('Cannot delete the vault owner.')
        }
        const user = await storage.fetch_user(username)
        if (!user) throw new Error(`User '${username}' not found in vault.`)
        await storage.remove_user(username)
        return { ok: true }
    })

    handle('vault:keys', () => {
        const vault_dir = get_active_vault_dir()
        return {
            privateKey: load_private_key_str(vault_dir),
            publicKey: load_public_key_str(vault_dir),
        }
    })

    /**
     * Serialize the matching secrets for one recipient. Shared by the
     * export / export-save / send-slack handlers.
     */
    async function export_for(storage, { to, filter, serializer, system }) {
        const admin = await storage.fetch_admin()
        const vault_dir = get_active_vault_dir()
        const sender_private_key = decode_key(load_private_key_str(vault_dir))
        const SerializerClass = get_serializer(serializer)

        const receiver = await storage.fetch_user(to)
        if (!receiver) {
            throw new Error(`User '${to}' not found in vault.`)
        }

        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length === 0) {
            throw new Error('No matching secrets found.')
        }

        const ser = new SerializerClass({
            sender: admin,
            receiver,
            sender_private_key,
        })

        return {
            receiver,
            output: ser.dumps(secrets, system),
            count: secrets.length,
        }
    }

    // `to` may be one username or a list; each recipient gets their own
    // (per-key encrypted) output.
    handle('secrets:export', async (_event, { to, filter, serializer, system }) => {
        const storage = get_storage()
        const recipients = Array.isArray(to) ? to : [to]
        const results = []
        let count = 0
        for (const username of recipients) {
            const r = await export_for(storage, {
                to: username, filter, serializer, system,
            })
            count = r.count
            results.push({
                username,
                email: r.receiver.email,
                output: r.output,
                count: r.count,
            })
        }
        return { count, results }
    })

    const EXPORT_EXT = {
        'json-crypt': 'json', backup: 'json', env: 'env', command: 'txt',
    }

    function safe_filename(s) {
        return String(s).replace(/[^a-z0-9._@-]+/gi, '_')
    }

    handle('secrets:export-save', async (_event, { to, filter, serializer, system }) => {
        const storage = get_storage()
        const recipients = Array.isArray(to) ? to : [to]
        const results = []
        for (const username of recipients) {
            const r = await export_for(storage, {
                to: username, filter, serializer, system,
            })
            results.push({ username, output: r.output, count: r.count })
        }

        const ext = EXPORT_EXT[serializer] || 'txt'
        const win = BrowserWindow.getFocusedWindow()
        const saved = []

        if (results.length === 1) {
            const r = await dialog.showSaveDialog(win, {
                title: 'Save export',
                defaultPath: `seeqret-${safe_filename(results[0].username)}.${ext}`,
            })
            if (r.canceled || !r.filePath) return { canceled: true, saved: [] }
            fs.writeFileSync(r.filePath, results[0].output, 'utf-8')
            saved.push(r.filePath)
        } else {
            const r = await dialog.showOpenDialog(win, {
                title: 'Choose a directory for the export files',
                properties: ['openDirectory', 'createDirectory'],
            })
            if (r.canceled || r.filePaths.length === 0) {
                return { canceled: true, saved: [] }
            }
            for (const res of results) {
                const p = path.join(
                    r.filePaths[0],
                    `seeqret-${safe_filename(res.username)}.${ext}`,
                )
                fs.writeFileSync(p, res.output, 'utf-8')
                saved.push(p)
            }
        }
        return { canceled: false, saved, count: results[0]?.count ?? 0 }
    })

    handle('secrets:send-slack', async (_event, { to, filter }) => {
        const { storage, snap, client } = await slack_ctx()
        const recipients = Array.isArray(to) ? to : [to]
        const results = []
        for (const username of recipients) {
            try {
                // Same guardrail as CLI `send --via slack`: the recipient
                // must hold a verified slack binding.
                await require_verified_binding(storage, username)
                const r = await export_for(storage, {
                    to: username, filter, serializer: 'json-crypt', system: null,
                })
                if (!r.receiver.email) {
                    throw new Error('user has no email to resolve on Slack')
                }
                const slack_user =
                    await client.lookup_user_by_email(r.receiver.email)
                if (!slack_user) {
                    throw new Error(
                        `no Slack user found for ${r.receiver.email}`
                    )
                }
                const sent = await send_blob({
                    client,
                    channel_id: snap.channel_id,
                    recipient_slack_user_id: slack_user.id,
                    ciphertext: r.output,
                })
                results.push({
                    username, ok: true, count: r.count, file_id: sent.file_id,
                })
                log_info(`secrets:send-slack ${r.count} secret(s) -> ${username}`)
            } catch (e) {
                log_error(`secrets:send-slack ${username}:`, e)
                results.push({ username, ok: false, error: e.message })
            }
        }
        return { results }
    })

    handle('secrets:import', async (_event, { from_user, serializer, content }) => {
        const storage = get_storage()
        const vault_dir = get_active_vault_dir()
        const receiver_private_key = decode_key(load_private_key_str(vault_dir))
        const SerializerClass = get_serializer(serializer)

        let sender = null
        if (from_user) {
            sender = await storage.fetch_user(from_user)
            if (!sender) {
                throw new Error(`User '${from_user}' not found in vault.`)
            }
        } else if (serializer === 'json-crypt') {
            const data = JSON.parse(content)
            if (data.from) {
                sender = await storage.fetch_user(data.from)
            }
        }

        const ser = new SerializerClass({
            sender,
            receiver_private_key,
        })

        const secrets = ser.load(content)
        let count = 0
        for (const secret of secrets) {
            await storage.add_secret(secret)
            count++
        }

        return { count }
    })

    handle('vault:introduction', async () => {
        const storage = get_storage()
        const user = await fetch_self(storage)

        if (!user) {
            throw new Error(
                `You (${qualified_user()}) are not registered in this vault. `
                + 'Ask the vault owner to add you.'
            )
        }

        return {
            username: user.username,
            name: user.name,
            email: user.email,
            pubkey: user.pubkey,
            fingerprint: compute_fingerprint(user),
        }
    })

    handle('serializers:list', () => {
        return list_serializers().map(cls => ({
            tag: cls.tag,
            description: cls.description,
        }))
    })

    // -- Vault registry ------------------------------------------------

    handle('vaults:list', () => {
        const vaults = registry_list().map(v => ({
            ...v,
            initialized: fs.existsSync(path.join(v.path, 'seeqrets.db')),
        }))

        // Include vaults from JSEEQRET / SEEQRET env vars
        const registered_paths = new Set(vaults.map(v => path.resolve(v.path)))
        for (const env_key of ['JSEEQRET', 'SEEQRET']) {
            const value = process.env[env_key]
            if (!value) continue
            const is_abs = path.isAbsolute(value) || value.startsWith('.')
                || value.includes('/') || value.includes('\\')
            if (!is_abs) continue  // name-based — already in registry
            const resolved = path.resolve(value)
            if (registered_paths.has(resolved)) continue
            registered_paths.add(resolved)
            vaults.push({
                name: path.basename(resolved),
                path: resolved,
                is_default: false,
                initialized: fs.existsSync(path.join(resolved, 'seeqrets.db')),
                from_env: env_key,
            })
        }

        return vaults
    })

    handle('vaults:add', (_event, { name, vault_path }) => {
        registry_add(name, vault_path)
        return { ok: true }
    })

    handle('vaults:remove', (_event, { name }) => {
        if (!registry_remove(name)) {
            throw new Error(`Vault "${name}" is not registered`)
        }
        return { ok: true }
    })

    handle('vaults:switch', async (_event, { name, vault_path }) => {
        // If switching to an env-var vault not yet in registry, register it
        if (vault_path) {
            registry_add(name, vault_path)
        }
        registry_use(name)
        // Bring the newly-active vault's schema up to date (it may predate
        // a migration this build adds, e.g. the onboarding table).
        await ensure_migrated(get_active_vault_dir())
        return { ok: true }
    })

    handle('vaults:create', async (_event, opts = {}) => {
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showOpenDialog(win, {
            title: 'Choose directory for new vault',
            properties: ['openDirectory', 'createDirectory'],
        })

        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true }
        }

        const chosen_dir = result.filePaths[0]
        const vault_dir = path.join(chosen_dir, 'seeqret')

        if (!fs.existsSync(vault_dir)) {
            fs.mkdirSync(vault_dir, { mode: 0o770, recursive: true })
        }

        harden_vault_windows(vault_dir)
        generate_symmetric_key(vault_dir)
        const key_pair = generate_and_save_key_pair(vault_dir)
        const pubkey = encode_key(key_pair.publicKey)

        // Owner identity is the hostname-qualified username (user@host),
        // matching CLI `init` and the Python seeqret tool so GUI- and
        // CLI-created vaults stay interchangeable. Email is a placeholder
        // until the user sets a real one (e.g. during onboarding).
        const username = qualified_user()
        const email = username
        await run_migrations(vault_dir, username, email, pubkey)

        // Register with basename of chosen dir as vault name
        const vault_name = path.basename(chosen_dir)
        registry_add(vault_name, vault_dir)
        registry_use(vault_name)

        // Human display name (the wizard asks for it): stamp it on the
        // owner row so introductions and approvals carry a real name.
        if (opts && opts.name) {
            await get_storage().update_user(username, { name: opts.name })
        }

        // A vault created from the first-run wizard keeps onboarding
        // marked in-progress so the wizard survives `initialized`
        // flipping true (see vault:status).
        if (opts && opts.onboarding) {
            await set_wizard_state(get_storage(), 'active')
        }
        log_info(`vaults:create ${vault_dir}`
            + ` (onboarding=${!!(opts && opts.onboarding)})`)

        return {
            canceled: false,
            name: vault_name,
            path: vault_dir,
        }
    })

    handle('vaults:default', () => {
        return registry_default()
    })

    // -- Slack session (Phase 4) ---------------------------------------

    handle('slack:status', async () => {
        return slack_session_status(get_storage())
    })

    handle('slack:login', async () => {
        const storage = get_storage()
        // The loopback OAuth flow runs in the main process; the channel
        // picker is surfaced to the renderer as return data.
        return slack_oauth_login(storage, {
            open_browser: (url) => shell.openExternal(url),
        })
    })

    handle('slack:set-channel', async (_event, { channel_id, channel_name }) => {
        await slack_set_channel(get_storage(), channel_id, channel_name)
        return { ok: true }
    })

    handle('slack:doctor', async () => {
        const status = await slack_session_status(get_storage())
        return { ready: status.ready, problems: status.problems }
    })

    // Live transport probe: send a selftest envelope to yourself, prove
    // the poller matches it, delete it. Catches real-Slack failures the
    // mocked test suite cannot (see tasks/lessons.md, share-ts incident).
    handle('slack:selftest', async () => {
        const { snap, client } = await slack_ctx()
        const r = await transport_selftest(client, {
            channel_id: snap.channel_id, self_user_id: snap.user_id,
        })
        log_info(`slack:selftest ok=${r.ok}`
            + (r.error ? ` error=${r.error}` : ''))
        return r
    })

    // GUI counterpart to `slack doctor --accept`: records the operator's
    // SSO + hardware-MFA attestation. The renderer obtains an explicit
    // confirmation before invoking. Returns the refreshed status.
    handle('slack:attest', async () => {
        const storage = get_storage()
        await slack_attest_mfa(storage)
        return slack_session_status(storage)
    })

    handle('slack:logout', async () => {
        await slack_config_clear_all(get_storage())
        return { ok: true }
    })

    handle('slack:link', async (_event, { username, handle, fingerprint }) => {
        const storage = get_storage()
        const user = await storage.fetch_user(username)
        if (!user) throw new Error(`Unknown user: ${username}`)
        // Re-validate the out-of-band fingerprint type-back in the main
        // process; the renderer input is UX, not authority.
        if (compute_fingerprint(user) !== fingerprint) {
            throw new Error('Fingerprint mismatch; refusing to bind.')
        }
        await bind_slack_handle(storage, username, handle || username.split('@')[0])
        return { ok: true }
    })

    // -- Onboarding: Team Lead side (Phases 5, 7) ----------------------

    function get_self_or_throw(storage) {
        return fetch_self(storage).then(self => {
            if (!self) {
                throw new Error(
                    `You (${qualified_user()}) are not registered in this vault.`
                )
            }
            return self
        })
    }

    async function slack_ctx() {
        await ensure_migrated(get_active_vault_dir())
        const storage = get_storage()
        const snap = await slack_config_snapshot(storage)
        assert_slack_ready(snap)
        const client = new SlackClient(snap.user_token)
        return { storage, snap, client }
    }

    handle('onboard:invite', async (_event, { email, project, name }) => {
        const { storage, snap, client } = await slack_ctx()
        const self = await get_self_or_throw(storage)
        const r = await onboard_invite(storage, client, {
            email, project, name: name || null,
            channel_id: snap.channel_id, self,
        })
        log_info(`onboard:invite sent to ${email} (slack ${r.slack_user_id})`)
        return { ok: true, slack_user_id: r.slack_user_id, fingerprint: compute_fingerprint(self) }
    })

    handle('onboard:list', async () => {
        await ensure_migrated(get_active_vault_dir())
        return get_storage().onboarding_list()
    })

    handle('onboard:poll', async () => {
        const { storage, snap, client } = await slack_ctx()
        await expire_stale_onboarding(storage)
        const oldest = await slack_config_get(storage, SLACK_KEYS.onboard_last_seen_ts) || '0'
        const receiver_private_key =
            decode_key(load_private_key_str(get_active_vault_dir()))
        const r = await onboard_poll(storage, client, {
            channel_id: snap.channel_id, self_user_id: snap.user_id,
            oldest_ts: oldest, receiver_private_key,
        })
        // Advance past everything handled, plus long-dead noise the
        // poller can never match (stale_ts) -- it was re-scanned from
        // oldest=0 on every poll otherwise. Compare numerically but keep
        // Slack's own ts strings (no float reformatting).
        const next = [oldest, r.highest_ts, r.stale_ts]
            .filter(Boolean)
            .reduce((a, b) => (Number(b) > Number(a) ? b : a))
        if (next !== oldest) {
            await slack_config_set(storage, SLACK_KEYS.onboard_last_seen_ts, next)
        }
        for (const ev of r.events) {
            log_info(`onboard:poll ${ev.kind} from ${ev.email}`
                + ` expected=${ev.expected}`)
        }
        const list = await storage.onboarding_list()
        return { events: r.events, list }
    })

    handle('onboard:approve', async (_event, { email, verified, fingerprint }) => {
        const { storage, snap, client } = await slack_ctx()
        const self = await get_self_or_throw(storage)
        const sender_private_key = decode_key(load_private_key_str(get_active_vault_dir()))
        const summary = await onboard_approve(storage, client, {
            email, verified, fingerprint,
            channel_id: snap.channel_id, self, sender_private_key,
        })
        log_info(`onboard:approve ${email}: ${summary.users_sent} users,`
            + ` ${summary.secrets_sent} secrets, ${summary.broadcasts} broadcasts`)
        return { ok: true, ...summary }
    })

    // -- Onboarding: new-user side (Phase 6) ---------------------------

    // Cheap local probe for the wizard: is a verified team-lead key on
    // file? Asking this directly keeps the expected "not yet" answer out
    // of the error log (provision-poll used to throw for it).
    handle('onboard:trust-status', async () => {
        await ensure_migrated(get_active_vault_dir())
        const trust = await get_tl_trust(get_storage())
        return { has_trust: !!trust.tl_pubkey }
    })

    handle('onboard:receive-invite', async () => {
        const { storage, snap, client } = await slack_ctx()
        const invite = await onboard_receive_invite(storage, client, {
            channel_id: snap.channel_id, self_user_id: snap.user_id,
        })
        log_info(invite
            ? `onboard:receive-invite invite for ${invite.email} (tl ${invite.tl_slack_user_id})`
            : 'onboard:receive-invite no invite waiting in the channel')
        return invite
    })

    // Sends the introduction WITHOUT anchoring any trust: it only
    // publishes the user's own pubkey/fingerprint. Idempotent per invited
    // email so the wizard can call it on every refresh; `force` re-sends
    // (recovery). The voice-call gate stays on onboard:join below.
    handle('onboard:introduce', async (_event, { tl_slack_user_id, email, force }) => {
        const { storage, snap, client } = await slack_ctx()
        const self = await get_self_or_throw(storage)
        const r = await onboard_introduce(storage, client, {
            channel_id: snap.channel_id, self, tl_slack_user_id,
            email, force: !!force,
        })
        if (r.sent) log_info(`onboard:introduce sent as ${r.email}`)
        return { ok: true, sent: r.sent, fingerprint: compute_fingerprint(self) }
    })

    handle('onboard:join', async (_event, opts) => {
        const { storage, snap, client } = await slack_ctx()
        const self = await get_self_or_throw(storage)
        const { tl_slack_user_id, tl_pubkey, tl_fingerprint, project, email, force } = opts
        await set_tl_trust(storage, {
            user_id: tl_slack_user_id, pubkey: tl_pubkey,
            fingerprint: tl_fingerprint, project,
        })
        // Guarded: if the wizard already auto-introduced under this email,
        // confirming the verification only anchors trust (no duplicate
        // introduction on Slack). Recovery passes force to re-send.
        const r = await onboard_introduce(storage, client, {
            channel_id: snap.channel_id, self, tl_slack_user_id,
            email, force: !!force,
        })
        log_info(r.sent
            ? `onboard:join introduction sent as ${r.email}`
            : `onboard:join trust anchored (already introduced as ${r.email})`)
        return { ok: true, sent: r.sent, fingerprint: compute_fingerprint(self) }
    })

    handle('onboard:provision-poll', async () => {
        const { storage, snap, client } = await slack_ctx()
        const trust = await get_tl_trust(storage)
        if (!trust.tl_pubkey) {
            throw new Error('No team-lead trust on file yet. Run join first.')
        }
        const receiver_private_key = decode_key(load_private_key_str(get_active_vault_dir()))
        const oldest = await slack_config_get(
            storage, SLACK_KEYS.onboard_user_last_seen_ts) || '0'
        const r = await onboard_provision_poll(storage, client, {
            channel_id: snap.channel_id, self_user_id: snap.user_id,
            receiver_private_key, trusted_pubkey: trust.tl_pubkey,
            oldest_ts: oldest,
        })
        if (r.imported_users || r.imported_secrets || r.complete) {
            log_info(`onboard:provision-poll imported`
                + ` ${r.imported_users} users, ${r.imported_secrets} secrets,`
                + ` complete=${r.complete}`)
        }
        for (const w of r.warnings) {
            log_error(`onboard:provision-poll ${w.kind}: ${w.error}`)
        }
        // Fail-closed cursor: never advance while anything in this sweep
        // failed to import; otherwise move past everything handled plus
        // long-dead unmatched noise (stale_ts).
        if (r.warnings.length === 0) {
            const next = [oldest, r.highest_ts, r.stale_ts]
                .filter(Boolean)
                .reduce((a, b) => (Number(b) > Number(a) ? b : a))
            if (next !== oldest) {
                await slack_config_set(
                    storage, SLACK_KEYS.onboard_user_last_seen_ts, next)
            }
        }
        // Provisioning landed: tell the TL so they can delete their own
        // provisioning envelopes (we usually cannot). Best-effort + one-
        // shot; a failure just means the envelopes wait for retention.
        if (r.complete) {
            try {
                const ack = await onboard_send_received_ack(storage, client, {
                    channel_id: snap.channel_id,
                    private_key: receiver_private_key,
                })
                if (ack.sent) log_info('onboard:provision-poll received-ack sent')
            } catch (e) {
                log_error('onboard:provision-poll received-ack failed:', e)
            }
        }
        return r
    })

    // -- Introductions inbox (existing-teammate side) --------------------

    handle('onboard:inbox', async () => {
        const { storage, snap, client } = await slack_ctx()
        const trust = await get_tl_trust(storage)
        const receiver_private_key =
            decode_key(load_private_key_str(get_active_vault_dir()))
        return inbox_introductions(storage, client, {
            channel_id: snap.channel_id, self_user_id: snap.user_id,
            receiver_private_key, trusted_pubkey: trust.tl_pubkey,
        })
    })

    handle('onboard:accept', async (_event, opts) => {
        const { payload, file_id, reply_ts, verified, fingerprint } = opts
        const { storage, snap, client } = await slack_ctx()
        const trust = await get_tl_trust(storage)
        const receiver_private_key =
            decode_key(load_private_key_str(get_active_vault_dir()))
        const imported = await accept_introduction(storage, client, {
            channel_id: snap.channel_id, payload, file_id, reply_ts,
            receiver_private_key, trusted_pubkey: trust.tl_pubkey,
            verified: !!verified, fingerprint: fingerprint || null,
        })
        log_info(`onboard:accept imported ${imported.length} user(s)`)
        return { ok: true, imported: imported.map(u => u.toJSON()) }
    })

    // Clears the first-run wizard flag -- called when the wizard's done
    // step is dismissed or the user explicitly skips onboarding.
    handle('onboard:wizard-done', async () => {
        await ensure_migrated(get_active_vault_dir())
        await set_wizard_state(get_storage(), null)
        log_info('onboard:wizard-done')
        return { ok: true }
    })

    handle('app:open-logs', () => {
        const dir = get_log_dir()
        if (dir) shell.openPath(dir)
        return { ok: true, dir }
    })
}
