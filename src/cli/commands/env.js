import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault } from '../utils.js'

const require = createRequire(import.meta.url)
const { version: pkg_version } = require('../../../package.json')

/**
 * Parse version requirement like "@seeqret>=0.3".
 * @param {string} line
 * @returns {{ op: string, version: string }|null}
 */
function parse_version_requirement(line) {
    const match = line.match(/@seeqret\s*([><=!]+)\s*([\d.]+)/)
    if (!match) return null
    return { op: match[1], version: match[2] }
}

function compare_versions(a, b) {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0
        const nb = pb[i] || 0
        if (na > nb) return 1
        if (na < nb) return -1
    }
    return 0
}

function check_version(requirement, current_version) {
    const cmp = compare_versions(current_version, requirement.version)
    switch (requirement.op) {
        case '>=': return cmp >= 0
        case '<=': return cmp <= 0
        case '==': return cmp === 0
        case '!=': return cmp !== 0
        case '>': return cmp > 0
        case '<': return cmp < 0
        default: return cmp >= 0
    }
}

/**
 * Print each duplicated .env key with the env.template lines and vault
 * secrets (or constants) that produced it.
 *
 * @param {Map<string, {lineno: number, template_line: string,
 *     origin: string}[]>} duplicates output key -> its sources
 */
function report_env_duplicates(duplicates) {
    for (const [key, key_sources] of duplicates) {
        console.error(`Duplicate key: ${key}`)
        const width = Math.max(
            ...key_sources.map(s => s.template_line.length)
        )
        for (const { lineno, template_line, origin } of key_sources) {
            console.error(
                `    env.template:${lineno}  `
                + `${template_line.padEnd(width)}  ->  ${origin}`
            )
        }
    }

    const count = duplicates.size
    const plural = count === 1 ? 'key' : 'keys'
    console.error(
        `\nFound ${count} duplicate ${plural} in env.template`
        + ' (not creating .env file)'
    )
    console.error(
        'Narrow the filters (e.g. app:env:KEY), or give one of them'
        + ' a different name with NAME=app:env:KEY.'
    )
}

/**
 * Materialize an `.env` file in the current directory from an
 * `env.template` driver file. Template entries can be raw filter specs,
 * `OUTPUT_NAME=filter` renames, `NAME=value` constants, or
 * `@seeqret>=X.Y` version guards that abort if the installed tool is
 * too old. A quoted right side is always a constant, even if it
 * contains colons; an unquoted right side with a colon is a filter.
 *
 * @example
 * // env.template
 * // @seeqret>=1.0
 * // myapp:prod:*
 * // DB_URL=myapp:prod:DATABASE_URL
 * // NODE_ENV=production
 * // BETTER_AUTH_URL="http://localhost:5176"
 * jseeqret env
 */
export const env_command = new Command('env')
    .description('Generate .env file from env.template')
    .action(async () => {
        require_vault()

        const template_path = path.join(process.cwd(), 'env.template')

        if (!fs.existsSync(template_path)) {
            console.error('Error: env.template not found in current directory.')
            process.exit(1)
        }

        const storage = new SqliteStorage()
        const lines = fs.readFileSync(template_path, 'utf-8').split('\n')
        // output key -> value, in template order (first match wins)
        const env_values = new Map()
        // output key -> [{ lineno, template_line, origin }]
        const sources = new Map()

        const add_entry = (key, get_value, lineno, template_line, origin) => {
            if (!sources.has(key)) {
                env_values.set(key, get_value())
                sources.set(key, [])
            }
            sources.get(key).push({ lineno, template_line, origin })
        }

        for (const [i, raw_line] of lines.entries()) {
            const lineno = i + 1
            const line = raw_line.trim()
            if (!line || line.startsWith('#')) continue

            // Version requirement
            if (line.startsWith('@')) {
                const req = parse_version_requirement(line)
                if (req) {
                    if (!check_version(req, pkg_version)) {
                        console.error(`Error: Requires seeqret${req.op}${req.version}, you have ${pkg_version}`)
                        console.error('Upgrade with: npm install -g jseeqret')
                        process.exit(1)
                    }
                } else {
                    console.error(`Error: Unknown directive: ${line}`)
                    process.exit(1)
                }
                continue
            }

            // Rename syntax (OUTPUT_NAME=FILTER) or constant (NAME=value)
            let output_name = null
            let filter_str = line
            const eq = line.indexOf('=')
            const colon = line.indexOf(':')
            if (eq !== -1 && (colon === -1 || eq < colon)) {
                const name = line.slice(0, eq).trim()
                const rhs = line.slice(eq + 1).trim()
                const quoted = rhs.length >= 2 &&
                    rhs[0] === rhs[rhs.length - 1] &&
                    (rhs[0] === '"' || rhs[0] === "'")
                if (quoted || !rhs.includes(':')) {
                    // Constant value, no vault lookup. A quoted value is
                    // always a constant, even if it contains colons
                    // (e.g. URL="http://localhost:5176"); the quotes are
                    // stripped since the output adds its own.
                    const value = quoted ? rhs.slice(1, -1) : rhs
                    add_entry(
                        name, () => value, lineno, line, 'constant value'
                    )
                    continue
                }
                // Rename syntax: OUTPUT_NAME=app:env:key
                output_name = name
                filter_str = rhs
            }

            const fspec = new FilterSpec(filter_str)
            const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

            for (const secret of secrets) {
                add_entry(
                    output_name || secret.key,
                    () => secret.get_value(),
                    lineno,
                    line,
                    `${secret.app}:${secret.env}:${secret.key}`,
                )
            }
        }

        const duplicates = new Map(
            [...sources].filter(([, key_sources]) => key_sources.length > 1)
        )
        if (duplicates.size > 0) {
            report_env_duplicates(duplicates)
            process.exit(1)
        }

        const env_lines = []
        for (const [key, value] of env_values) {
            env_lines.push(`${key}="${value}"`)
            console.log(`  ${key}`)
        }

        if (env_lines.length === 0) {
            console.log('No matching secrets found.')
            return
        }

        const env_path = path.join(process.cwd(), '.env')
        fs.writeFileSync(env_path, env_lines.join('\n') + '\n', 'utf-8')
        console.log(`\nWrote ${env_lines.length} variable(s) to .env`)
    })
