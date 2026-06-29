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
    createVault: () => ipcRenderer.invoke('vaults:create'),
    getDefaultVault: () => ipcRenderer.invoke('vaults:default'),
    checkForUpdate: () => ipcRenderer.invoke('app:check-update'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    onUpdateStatus: (callback) => {
        const handler = (_event, data) => callback(data)
        ipcRenderer.on('update:status', handler)
        return () => ipcRenderer.removeListener('update:status', handler)
    },

    // Slack session (Phase 4)
    slackStatus: () => ipcRenderer.invoke('slack:status'),
    slackLogin: () => ipcRenderer.invoke('slack:login'),
    slackSetChannel: (data) => ipcRenderer.invoke('slack:set-channel', data),
    slackDoctor: () => ipcRenderer.invoke('slack:doctor'),
    slackLogout: () => ipcRenderer.invoke('slack:logout'),
    slackLink: (data) => ipcRenderer.invoke('slack:link', data),

    // Onboarding — Team Lead side
    onboardInvite: (data) => ipcRenderer.invoke('onboard:invite', data),
    onboardList: () => ipcRenderer.invoke('onboard:list'),
    onboardPoll: () => ipcRenderer.invoke('onboard:poll'),
    onboardApprove: (data) => ipcRenderer.invoke('onboard:approve', data),

    // Onboarding — new-user side
    onboardReceiveInvite: () => ipcRenderer.invoke('onboard:receive-invite'),
    onboardJoin: (data) => ipcRenderer.invoke('onboard:join', data),
    onboardProvisionPoll: () => ipcRenderer.invoke('onboard:provision-poll'),
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
