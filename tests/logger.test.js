import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { set_log_level, get_log_level, logger } from '../src/core/logger.js'

beforeEach(() => {
    set_log_level('ERROR') // reset to default
})

afterEach(() => {
    vi.restoreAllMocks()
    set_log_level('ERROR')
})

describe('set_log_level / get_log_level', () => {
    it('defaults to ERROR', () => {
        expect(get_log_level()).toBe('ERROR')
    })

    it('sets DEBUG level', () => {
        set_log_level('DEBUG')
        expect(get_log_level()).toBe('DEBUG')
    })

    it('sets INFO level', () => {
        set_log_level('INFO')
        expect(get_log_level()).toBe('INFO')
    })

    it('sets WARNING level', () => {
        set_log_level('WARNING')
        expect(get_log_level()).toBe('WARNING')
    })

    it('is case-insensitive', () => {
        set_log_level('debug')
        expect(get_log_level()).toBe('DEBUG')
    })

    it('ignores unknown levels', () => {
        set_log_level('DEBUG')
        set_log_level('INVALID')
        expect(get_log_level()).toBe('DEBUG')
    })
})

describe('logger output', () => {
    it('logger.error outputs when level is ERROR', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        logger.error('test message')
        expect(spy).toHaveBeenCalledWith('[ERROR]', 'test message')
    })

    it('logger.warning outputs when level is WARNING', () => {
        set_log_level('WARNING')
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        logger.warning('warn msg')
        expect(spy).toHaveBeenCalledWith('[WARNING]', 'warn msg')
    })

    it('logger.info outputs when level is INFO', () => {
        set_log_level('INFO')
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        logger.info('info msg')
        expect(spy).toHaveBeenCalledWith('[INFO]', 'info msg')
    })

    it('logger.debug outputs when level is DEBUG', () => {
        set_log_level('DEBUG')
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        logger.debug('debug msg')
        expect(spy).toHaveBeenCalledWith('[DEBUG]', 'debug msg')
    })

    it('suppresses DEBUG when level is ERROR', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        logger.debug('should not appear')
        expect(spy).not.toHaveBeenCalled()
    })

    it('suppresses INFO when level is WARNING', () => {
        set_log_level('WARNING')
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
        logger.info('should not appear')
        expect(spy).not.toHaveBeenCalled()
    })

    it('suppresses WARNING when level is ERROR', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        logger.warning('should not appear')
        expect(spy).not.toHaveBeenCalled()
    })

    it('supports multiple arguments', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        logger.error('msg', 42, { key: 'val' })
        expect(spy).toHaveBeenCalledWith('[ERROR]', 'msg', 42, { key: 'val' })
    })
})
