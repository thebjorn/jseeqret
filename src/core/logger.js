/**
 * Simple logging module compatible with Python's logging levels.
 */

const LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARNING: 2,
    ERROR: 3,
}

let current_level = LEVELS.ERROR

/**
 * Set the global log level.
 * @param {string} level - one of DEBUG, INFO, WARNING, ERROR
 */
export function set_log_level(level) {
    const upper = level.toUpperCase()
    if (upper in LEVELS) {
        current_level = LEVELS[upper]
    }
}

/**
 * Get the current log level name.
 * @returns {string}
 */
export function get_log_level() {
    for (const [name, val] of Object.entries(LEVELS)) {
        if (val === current_level) return name
    }
    return 'ERROR'
}

function log(level, ...args) {
    if (LEVELS[level] >= current_level) {
        const prefix = `[${level}]`
        if (level === 'ERROR') {
            console.error(prefix, ...args)
        } else if (level === 'WARNING') {
            console.warn(prefix, ...args)
        } else {
            console.log(prefix, ...args)
        }
    }
}

export const logger = {
    debug: (...args) => log('DEBUG', ...args),
    info: (...args) => log('INFO', ...args),
    warning: (...args) => log('WARNING', ...args),
    error: (...args) => log('ERROR', ...args),
}
