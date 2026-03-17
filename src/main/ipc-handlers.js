import { ipcMain } from 'electron'
import { SqliteStorage } from '../core/sqlite-storage.js'
import { FilterSpec } from '../core/filter.js'
import { Secret } from '../core/models/secret.js'
import { User } from '../core/models/user.js'
import { is_initialized, get_seeqret_dir, current_user } from '../core/vault.js'
import { load_private_key_str, load_public_key_str } from '../core/crypto/utils.js'
import { decode_key } from '../core/crypto/nacl.js'
import { get_serializer, list_serializers } from '../core/serializers/index.js'

function get_storage() {
    return new SqliteStorage()
}

export function register_ipc_handlers() {
    ipcMain.handle('vault:status', () => {
        const initialized = is_initialized()
        return {
            initialized,
            vaultDir: initialized ? get_seeqret_dir() : null,
            currentUser: current_user(),
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
        const secret = new Secret({ app, env, key, plaintext_value: value, type: type || 'str' })
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
        const vault_dir = get_seeqret_dir()
        return {
            privateKey: load_private_key_str(vault_dir),
            publicKey: load_public_key_str(vault_dir),
        }
    })

    ipcMain.handle('secrets:export', async (_event, { to, filter, serializer, system }) => {
        const storage = get_storage()
        const admin = await storage.fetch_admin()
        const vault_dir = get_seeqret_dir()
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
        const vault_dir = get_seeqret_dir()
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
}
