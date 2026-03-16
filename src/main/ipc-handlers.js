import { ipcMain } from 'electron'
import { SqliteStorage } from '../core/sqlite-storage.js'
import { FilterSpec } from '../core/filter.js'
import { Secret } from '../core/models/secret.js'
import { User } from '../core/models/user.js'
import { isInitialized, getSeeqretDir, currentUser } from '../core/vault.js'
import { loadPrivateKeyStr, loadPublicKeyStr } from '../core/crypto/utils.js'

function getStorage() {
  return new SqliteStorage()
}

export function registerIpcHandlers() {
  ipcMain.handle('vault:status', () => {
    const initialized = isInitialized()
    return {
      initialized,
      vaultDir: initialized ? getSeeqretDir() : null,
      currentUser: currentUser(),
    }
  })

  ipcMain.handle('secrets:list', async (_event, filter = '*') => {
    const storage = getStorage()
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    return secrets.map(s => s.toPlaintextDict())
  })

  ipcMain.handle('secrets:get', async (_event, filter) => {
    const storage = getStorage()
    const fspec = new FilterSpec(filter)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length === 0) throw new Error(`No secrets found for ${filter}`)
    if (secrets.length > 1) throw new Error(`Found ${secrets.length} secrets for ${filter}`)
    return secrets[0].getValue()
  })

  ipcMain.handle('secrets:add', async (_event, { app, env, key, value, type }) => {
    const storage = getStorage()
    const secret = new Secret({ app, env, key, plaintextValue: value, type: type || 'str' })
    await storage.addSecret(secret)
    return { ok: true }
  })

  ipcMain.handle('secrets:update', async (_event, { app, env, key, value }) => {
    const storage = getStorage()
    const fspec = new FilterSpec(`${app}:${env}:${key}`)
    const secrets = await storage.fetchSecrets(fspec.toFilterDict())
    if (secrets.length === 0) throw new Error('Secret not found')
    secrets[0].setValue(value)
    await storage.updateSecret(secrets[0])
    return { ok: true }
  })

  ipcMain.handle('secrets:remove', async (_event, filter) => {
    const storage = getStorage()
    const fspec = new FilterSpec(filter)
    await storage.removeSecrets(fspec.toFilterDict())
    return { ok: true }
  })

  ipcMain.handle('users:list', async () => {
    const storage = getStorage()
    const users = await storage.fetchUsers()
    return users.map(u => u.toJSON())
  })

  ipcMain.handle('users:add', async (_event, { username, email, pubkey }) => {
    const storage = getStorage()
    const user = new User(username, email, pubkey)
    await storage.addUser(user)
    return { ok: true }
  })

  ipcMain.handle('vault:keys', () => {
    const vaultDir = getSeeqretDir()
    return {
      privateKey: loadPrivateKeyStr(vaultDir),
      publicKey: loadPublicKeyStr(vaultDir),
    }
  })
}
