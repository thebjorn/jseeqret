/**
 * Minimal file logger for the main process.
 *
 * A packaged Electron app has no console, so anything worth knowing when
 * onboarding (or any IPC handler) fails must land on disk. This is a
 * deliberate ~60-line append-only logger instead of a dependency: no
 * electron import (unit-testable), timestamps in ISO, single file with a
 * one-generation size rollover (main.log -> main.old.log).
 *
 * NEVER log payloads, tokens, or key material -- messages should carry
 * channel names, kinds, counts, and error strings only.
 */

import fs from 'fs'
import path from 'path'

const MAX_LOG_BYTES = 5 * 1024 * 1024

let _log_dir = null
let _log_path = null

/**
 * Point the logger at a directory (created if missing) and roll the
 * previous generation if the file is oversized. Until this is called,
 * log_info/log_error are console-only no-ops on disk.
 * @param {string} dir
 */
export function init_logger(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, 'main.log')
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
            fs.renameSync(file, path.join(dir, 'main.old.log'))
        }
        _log_dir = dir
        _log_path = file
    } catch (e) {
        // Logging must never take the app down.
        console.error('logger init failed:', e.message)
    }
}

/** @returns {string|null} directory the logs live in (for "Open logs") */
export function get_log_dir() {
    return _log_dir
}

/** @returns {string|null} full path of the current log file */
export function get_log_path() {
    return _log_path
}

function _write(level, parts) {
    const msg = parts
        .map(p => (p instanceof Error ? p.message : String(p)))
        .join(' ')
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`
    if (_log_path) {
        try {
            fs.appendFileSync(_log_path, line)
        } catch { /* never throw from logging */ }
    }
    return line
}

export function log_info(...parts) {
    console.log(_write('info', parts).trimEnd())
}

export function log_error(...parts) {
    console.error(_write('error', parts).trimEnd())
}
