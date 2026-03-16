/**
 * .env file parser - compatible with Python seeqret's parse_env_line().
 */

/**
 * Parse a .env file into an array of { key, value } objects.
 * Supports:
 *   KEY=value
 *   KEY="value"
 *   KEY='value'
 *   export KEY=value
 *   # comments
 *
 * @param {string} text - contents of .env file
 * @returns {Array<{ key: string, value: string }>}
 */
export function parse_env(text) {
    const results = []
    for (const raw_line of text.split('\n')) {
        const line = raw_line.trim()
        if (!line || line.startsWith('#')) continue

        let working = line
        if (working.startsWith('export ')) {
            working = working.slice(7).trim()
        }

        const eq = working.indexOf('=')
        if (eq === -1) continue

        const key = working.slice(0, eq).trim()
        let value = working.slice(eq + 1).trim()

        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        results.push({ key, value })
    }
    return results
}
