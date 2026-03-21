import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { register_ipc_handlers } from './ipc-handlers.js'

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        show: false,
        autoHideMenuBar: true,
        icon: join(__dirname, '../../build/icon.png'),
        webPreferences: {
            preload: join(__dirname, '../preload/index.mjs'),
            sandbox: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }

    return mainWindow
}

function setup_auto_updater(main_window) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    function send_status(status, info = {}) {
        main_window?.webContents?.send('update:status', { status, ...info })
    }

    autoUpdater.on('checking-for-update', () => {
        send_status('checking')
    })
    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version)
        send_status('available', { version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
        send_status('up-to-date')
    })
    autoUpdater.on('download-progress', (progress) => {
        send_status('downloading', { percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info.version)
        send_status('downloaded', { version: info.version })
    })
    autoUpdater.on('error', (err) => {
        console.error('Auto-update error:', err.message)
        send_status('error', { message: err.message })
    })

    ipcMain.handle('app:check-update', async () => {
        const result = await autoUpdater.checkForUpdates()
        return result?.updateInfo?.version ?? null
    })

    ipcMain.handle('app:install-update', () => {
        autoUpdater.quitAndInstall()
    })

    autoUpdater.checkForUpdatesAndNotify()
}

app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.jseeqret')

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    register_ipc_handlers()
    const main_window = createWindow()

    if (!is.dev) {
        setup_auto_updater(main_window)
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
