import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { SqliteStorage } from '../core/sqlite-storage.js'

const require = createRequire(import.meta.url)
const { version: pkg_version } = require('../../package.json')
import { FilterSpec } from '../core/filter.js'
import { Secret } from '../core/models/secret.js'
import { User } from '../core/models/user.js'
import { is_initialized, get_seeqret_dir, current_user } from '../core/vault.js'
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
import { run_migrations } from '../core/migrations.js'
import { harden_vault_windows } from '../core/fileutils.js'

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

export function register_ipc_handlers() {
    ipcMain.handle('vault:status', () => {
        let vault_dir
        let initialized = false
        try {
            vault_dir = get_active_vault_dir()
            initialized = fs.existsSync(vault_dir)
                && fs.existsSync(path.join(vault_dir, 'seeqrets.db'))
        } catch {
            vault_dir = null
        }
        return {
            initialized,
            vaultDir: initialized ? vault_dir : null,
            currentUser: current_user(),
            version: pkg_version,
            activeVault: registry_default(),
        }
    })

    ipcMain.handle('secrets:list', async (_event, filter = '*') => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        return secrets.map(s => s.to_plaintext_dict())
    })

    ipcMain.handle('secrets:get', async (_event, filter) => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        if (secrets.length === 0) throw new Error(`No secrets found for ${filter}`)
        if (secrets.length > 1) throw new Error(`Found ${secrets.length} secrets for ${filter}`)
        return secrets[0].get_value()
    })

    ipcMain.handle('secrets:add', async (_event, { app, env, key, value, type }) => {
        const storage = get_storage()
        const vault_dir = get_active_vault_dir()
        const secret = new Secret({ app, env, key, plaintext_value: value, type: type || 'str', vault_dir })
        await storage.add_secret(secret)
        return { ok: true }
    })

    ipcMain.handle('secrets:update', async (_event, { app, env, key, value }) => {
        const storage = get_storage()
        const fspec = new FilterSpec(`${app}:${env}:${key}`)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())
        if (secrets.length === 0) throw new Error('Secret not found')
        secrets[0].set_value(value)
        await storage.update_secret(secrets[0])
        return { ok: true }
    })

    ipcMain.handle('secrets:remove', async (_event, filter) => {
        const storage = get_storage()
        const fspec = new FilterSpec(filter)
        await storage.remove_secrets(fspec.to_filter_dict())
        return { ok: true }
    })

    ipcMain.handle('users:list', async () => {
        const storage = get_storage()
        const users = await storage.fetch_users()
        return users.map(u => u.toJSON())
    })

    ipcMain.handle('users:add', async (_event, { username, email, pubkey }) => {
        const storage = get_storage()
        const user = new User(username, email, pubkey)
        await storage.add_user(user)
        return { ok: true }
    })

    ipcMain.handle('vault:keys', () => {
        const vault_dir = get_active_vault_dir()
        return {
            privateKey: load_private_key_str(vault_dir),
            publicKey: load_public_key_str(vault_dir),
        }
    })

    ipcMain.handle('secrets:export', async (_event, { to, filter, serializer, system }) => {
        const storage = get_storage()
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

        const output = ser.dumps(secrets, system)
        return { output, count: secrets.length }
    })

    ipcMain.handle('secrets:import', async (_event, { from_user, serializer, content }) => {
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

    ipcMain.handle('vault:introduction', async () => {
        const storage = get_storage()
        const username = current_user()
        const user = await storage.fetch_user(username)

        if (!user) {
            throw new Error(
                `You (${username}) are not registered in this vault. `
                + 'Ask the vault owner to add you.'
            )
        }

        return {
            username: user.username,
            email: user.email,
            pubkey: user.pubkey,
        }
    })

    ipcMain.handle('serializers:list', () => {
        return list_serializers().map(cls => ({
            tag: cls.tag,
            description: cls.description,
        }))
    })

    // -- Vault registry ------------------------------------------------

    ipcMain.handle('vaults:list', () => {
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

    ipcMain.handle('vaults:add', (_event, { name, vault_path }) => {
        registry_add(name, vault_path)
        return { ok: true }
    })

    ipcMain.handle('vaults:remove', (_event, { name }) => {
        if (!registry_remove(name)) {
            throw new Error(`Vault "${name}" is not registered`)
        }
        return { ok: true }
    })

    ipcMain.handle('vaults:switch', (_event, { name, vault_path }) => {
        // If switching to an env-var vault not yet in registry, register it
        if (vault_path) {
            registry_add(name, vault_path)
        }
        registry_use(name)
        return { ok: true }
    })

    ipcMain.handle('vaults:create', async () => {
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

        const username = current_user()
        const email = `${username}@${os.hostname()}`
        await run_migrations(vault_dir, username, email, pubkey)

        // Register with basename of chosen dir as vault name
        const vault_name = path.basename(chosen_dir)
        registry_add(vault_name, vault_dir)
        registry_use(vault_name)

        return {
            canceled: false,
            name: vault_name,
            path: vault_dir,
        }
    })

    ipcMain.handle('vaults:default', () => {
        return registry_default()
    })
}
