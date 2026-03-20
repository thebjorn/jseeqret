import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
    getVaultStatus: () => ipcRenderer.invoke('vault:status'),
    getSecrets: (filter) => ipcRenderer.invoke('secrets:list', filter),
    getSecret: (filter) => ipcRenderer.invoke('secrets:get', filter),
    addSecret: (data) => ipcRenderer.invoke('secrets:add', data),
    updateSecret: (data) => ipcRenderer.invoke('secrets:update', data),
    removeSecret: (filter) => ipcRenderer.invoke('secrets:remove', filter),
    getUsers: () => ipcRenderer.invoke('users:list'),
    addUser: (data) => ipcRenderer.invoke('users:add', data),
    getVaultKeys: () => ipcRenderer.invoke('vault:keys'),
    exportSecrets: (opts) => ipcRenderer.invoke('secrets:export', opts),
    importSecrets: (opts) => ipcRenderer.invoke('secrets:import', opts),
    getIntroduction: () => ipcRenderer.invoke('vault:introduction'),
    getSerializers: () => ipcRenderer.invoke('serializers:list'),
    listVaults: () => ipcRenderer.invoke('vaults:list'),
    addVault: (data) => ipcRenderer.invoke('vaults:add', data),
    removeVault: (data) => ipcRenderer.invoke('vaults:remove', data),
    switchVault: (data) => ipcRenderer.invoke('vaults:switch', data),
    getDefaultVault: () => ipcRenderer.invoke('vaults:default'),
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    window.electron = electronAPI
    window.api = api
}
