import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { register_ipc_handlers, ensure_active_vault_migrated } from './ipc-handlers.js'
import { init_logger, log_info, log_error, log_trace } from './logger.js'
import { set_trace_sink } from '../core/trace.js'

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
        log_info('update available:', info.version)
        send_status('available', { version: info.version })
    })
    autoUpdater.on('update-not-available', () => {
        send_status('up-to-date')
    })
    autoUpdater.on('download-progress', (progress) => {
        send_status('downloading', { percent: Math.round(progress.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
        log_info('update downloaded:', info.version)
        send_status('downloaded', { version: info.version })
    })
    autoUpdater.on('error', (err) => {
        log_error('auto-update error:', err)
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

// Single-instance guard. A secrets manager must never run two processes
// against the same vault -- concurrent SQLite writers risk corruption. A
// second launch fails to take the lock and exits immediately; the running
// instance catches `second-instance` and refocuses its window instead.
const got_instance_lock = app.requestSingleInstanceLock()

if (!got_instance_lock) {
    app.quit()
} else {
    app.on('second-instance', () => {
        const [existing] = BrowserWindow.getAllWindows()
        if (existing) {
            if (existing.isMinimized()) existing.restore()
            existing.show()
            existing.focus()
        }
    })

    app.whenReady().then(async () => {
        electronApp.setAppUserModelId('com.jseeqret')

        // File logging: a packaged app has no console, so diagnostics
        // (IPC failures, onboarding events, crashes) must land on disk.
        init_logger(join(app.getPath('userData'), 'logs'))
        log_info(`jseeqret ${app.getVersion()} starting`)
        // Core Slack tracing -> log file (no console echo). High volume
        // but rotation-capped; the whole point is that a stalled flow in
        // the field leaves a readable trail. JSEEQRET_TRACE=0 disables.
        if (process.env.JSEEQRET_TRACE !== '0') {
            set_trace_sink(log_trace)
        }
        // Monitor variant: logs the crash without suppressing Electron's
        // default fatal handling.
        process.on('uncaughtExceptionMonitor', (e) => {
            log_error('uncaughtException:', e?.stack || e)
        })
        process.on('unhandledRejection', (e) => {
            log_error('unhandledRejection:', e?.stack || e)
        })

        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window)
        })

        register_ipc_handlers()
        // Migrate the active vault BEFORE the renderer mounts, so existing
        // vaults gain new tables (e.g. onboarding) without a race against the
        // first handler calls.
        await ensure_active_vault_migrated()
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
}
