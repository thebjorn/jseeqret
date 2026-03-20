import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { set_log_level, get_log_level, logger } from '../src/core/logger.js'

describe('log levels', () => {
    afterEach(() => {
        set_log_level('ERROR')  // reset to default
    })

    it('defaults to ERROR level', () => {
        expect(get_log_level()).toBe('ERROR')
    })

    it('set_log_level changes level', () => {
        set_log_level('DEBUG')
        expect(get_log_level()).toBe('DEBUG')
    })

    it('accepts lowercase level names', () => {
        set_log_level('info')
        expect(get_log_level()).toBe('INFO')
    })

    it('ignores invalid level names', () => {
        set_log_level('INFO')
        set_log_level('BOGUS')
        expect(get_log_level()).toBe('INFO')
    })

    it('cycles through all levels', () => {
        for (const level of ['DEBUG', 'INFO', 'WARNING', 'ERROR']) {
            set_log_level(level)
            expect(get_log_level()).toBe(level)
        }
    })
})

describe('logger output', () => {
    let spy_log, spy_warn, spy_error

    beforeEach(() => {
        spy_log = vi.spyOn(console, 'log').mockImplementation(() => {})
        spy_warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        spy_error = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        set_log_level('ERROR')
    })

    it('error() outputs at ERROR level', () => {
        set_log_level('ERROR')
        logger.error('test error')
        expect(spy_error).toHaveBeenCalledWith('[ERROR]', 'test error')
    })

    it('warning() uses console.warn', () => {
        set_log_level('WARNING')
        logger.warning('test warning')
        expect(spy_warn).toHaveBeenCalledWith('[WARNING]', 'test warning')
    })

    it('info() uses console.log', () => {
        set_log_level('INFO')
        logger.info('test info')
        expect(spy_log).toHaveBeenCalledWith('[INFO]', 'test info')
    })

    it('debug() uses console.log', () => {
        set_log_level('DEBUG')
        logger.debug('test debug')
        expect(spy_log).toHaveBeenCalledWith('[DEBUG]', 'test debug')
    })

    it('suppresses messages below current level', () => {
        set_log_level('WARNING')
        logger.debug('hidden')
        logger.info('hidden')
        expect(spy_log).not.toHaveBeenCalled()
    })

    it('shows messages at and above current level', () => {
        set_log_level('WARNING')
        logger.warning('visible')
        logger.error('visible')
        expect(spy_warn).toHaveBeenCalledTimes(1)
        expect(spy_error).toHaveBeenCalledTimes(1)
    })

    it('DEBUG level shows everything', () => {
        set_log_level('DEBUG')
        logger.debug('d')
        logger.info('i')
        logger.warning('w')
        logger.error('e')
        expect(spy_log).toHaveBeenCalledTimes(2)   // debug + info
        expect(spy_warn).toHaveBeenCalledTimes(1)
        expect(spy_error).toHaveBeenCalledTimes(1)
    })

    it('passes multiple arguments through', () => {
        set_log_level('ERROR')
        logger.error('msg', 42, { a: 1 })
        expect(spy_error).toHaveBeenCalledWith('[ERROR]', 'msg', 42, { a: 1 })
    })
})
