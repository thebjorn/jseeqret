import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
    init_logger, log_info, log_error, get_log_dir, get_log_path,
} from '../src/main/logger.js'

describe('main-process file logger', () => {
    let dir

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jseeqret-log-'))
        init_logger(dir)
    })

    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    })

    it('appends timestamped lines for info and error', () => {
        log_info('hello', 'world')
        log_error('boom:', new Error('bad thing'))

        const text = fs.readFileSync(get_log_path(), 'utf-8')
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T.* \[info\] hello world$/m)
        expect(text).toMatch(/\[error\] boom: bad thing/)
        expect(get_log_dir()).toBe(dir)
    })

    it('rolls an oversized log to main.old.log on init', () => {
        const file = path.join(dir, 'main.log')
        fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 1))

        init_logger(dir)

        expect(fs.existsSync(path.join(dir, 'main.old.log'))).toBe(true)
        log_info('fresh start')
        expect(fs.readFileSync(file, 'utf-8')).toMatch(/fresh start/)
        expect(fs.readFileSync(file, 'utf-8')).not.toMatch(/^x/)
    })

    it('never throws when pointed at an unwritable location', () => {
        init_logger(path.join(dir, 'nope\0bad'))
        expect(() => log_info('still fine')).not.toThrow()
    })
})
