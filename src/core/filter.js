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
function glob_to_regex(glob) {
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
export function glob_to_sql(glob) {
    return glob.replace(/\*/g, '%').replace(/\?/g, '_')
}

/**
 * Check if a value contains glob characters.
 * @param {string} value
 * @returns {boolean}
 */
export function has_glob_chars(value) {
    return /[[\].*?]/.test(value)
}

/**
 * Build a WHERE clause for one field: LIKE for glob values, = otherwise.
 * @param {string} field
 * @param {string} value
 * @returns {{ clause: string, params: string[] }}
 */
function sql_where_field(field, value) {
    if (has_glob_chars(value)) {
        return { clause: `${field} LIKE ?`, params: [glob_to_sql(value)] }
    }
    return { clause: `${field} = ?`, params: [value] }
}

/**
 * Build an OR clause for comma-separated values.
 * @param {string} field
 * @param {string[]} values
 * @returns {{ clause: string, params: string[] }}
 */
function sql_where_field_or(field, values) {
    const clauses = []
    const params = []

    for (const v of values) {
        if (v === '*') {
            clauses.push(`${field} LIKE ?`)
            params.push('%')
        } else {
            const { clause, params: p } = sql_where_field(field, v)
            clauses.push(clause)
            params.push(...p)
        }
    }

    return { clause: `(${clauses.join(' OR ')})`, params }
}

/**
 * Build a full SQL WHERE clause from a filter dict such as
 * `{ app: 'myapp', env: '*', key: 'DB_*' }`. Glob values match with
 * LIKE, comma-separated values with OR. Returns an empty clause for an
 * empty dict.
 *
 * @param {Object<string, string>} filters
 * @returns {{ clause: string, params: string[] }}
 */
export function sql_where_clause(filters) {
    if (!filters || Object.keys(filters).length === 0) {
        return { clause: '', params: [] }
    }

    const clauses = []
    const params = []

    for (const [k, v] of Object.entries(filters)) {
        const { clause, params: p } = v.includes(',')
            ? sql_where_field_or(k, v.split(','))
            : sql_where_field(k, v)
        clauses.push(clause)
        params.push(...p)
    }

    return {
        clause: ' WHERE ' + clauses.join(' AND '),
        params,
    }
}

export class FilterSpec {
    /**
     * @param {string} filter_spec - filter string like "app:env:key"
     */
    constructor(filter_spec) {
        this.filter_spec = filter_spec
        const parts = filter_spec.split(':')

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
    to_filter_dict() {
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
    match_item(val, pattern) {
        if (pattern === '*') return true
        const regex = new RegExp(glob_to_regex(pattern))
        return regex.test(val)
    }

    /**
     * Check if a [app, env, key] tuple matches this filter.
     * @param {Array<string>} item
     * @returns {boolean}
     */
    matches(item) {
        const patterns = [this.app, this.env, this.name]
        return item.every((val, i) => this.match_item(val, patterns[i]))
    }

    toString() {
        return `${this.app}:${this.env}:${this.name}`
    }
}
