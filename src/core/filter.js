/**
 * FilterSpec: parse and match app:env:key filter strings.
 *
 * Compatible with Python seeqret's FilterSpec.
 */

/**
 * Convert a glob pattern to a regex pattern.
 * @param {string} glob
 * @returns {string}
 */
function globToRegex(glob) {
  let regex = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  regex = regex.replace(/\*/g, '.*')
  regex = regex.replace(/\?/g, '.')
  return `^${regex}$`
}

/**
 * Convert a glob pattern to a SQL LIKE pattern.
 * @param {string} glob
 * @returns {string}
 */
export function globToSql(glob) {
  return glob.replace(/\*/g, '%').replace(/\?/g, '_')
}

/**
 * Check if a value contains glob characters.
 * @param {string} value
 * @returns {boolean}
 */
export function hasGlobChars(value) {
  return /[[\].*?]/.test(value)
}

export class FilterSpec {
  /**
   * @param {string} filterspec - filter string like "app:env:key"
   */
  constructor(filterspec) {
    this.filterspec = filterspec
    const parts = filterspec.split(':')

    if (parts.length === 1) {
      this.app = '*'
      this.env = '*'
      this.name = parts[0] || '*'
    } else if (parts.length === 2) {
      this.app = parts[0] || '*'
      this.env = parts[1] || '*'
      this.name = '*'
    } else {
      this.app = parts[0] || '*'
      this.env = parts[1] || '*'
      this.name = parts[2] || '*'
    }
  }

  /**
   * Convert to a filter dict for SQL queries.
   * @returns {{ app: string, env: string, key: string }}
   */
  toFilterDict() {
    return {
      app: this.app,
      env: this.env,
      key: this.name,
    }
  }

  /**
   * Check if a single value matches a glob pattern.
   * @param {string} val
   * @param {string} pattern
   * @returns {boolean}
   */
  matchItem(val, pattern) {
    if (pattern === '*') return true
    const regex = new RegExp(globToRegex(pattern))
    return regex.test(val)
  }

  /**
   * Check if a [app, env, key] tuple matches this filter.
   * @param {[string, string, string]} item
   * @returns {boolean}
   */
  matches(item) {
    const patterns = [this.app, this.env, this.name]
    return item.every((val, i) => this.matchItem(val, patterns[i]))
  }

  toString() {
    return `${this.app}:${this.env}:${this.name}`
  }
}
