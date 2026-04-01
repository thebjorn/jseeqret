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
        const env_lines = []
        const seen_keys = new Set()

        for (const raw_line of lines) {
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

            // Rename syntax: OUTPUT_NAME=FILTER
            let output_name = null
            let filter_str = line
            const eq = line.indexOf('=')
            if (eq !== -1 && !line.includes(':')) {
                // Simple KEY=filter without colons is a rename
                output_name = line.slice(0, eq).trim()
                filter_str = line.slice(eq + 1).trim()
            } else if (eq !== -1 && line.indexOf('=') < line.indexOf(':')) {
                output_name = line.slice(0, eq).trim()
                filter_str = line.slice(eq + 1).trim()
            }

            const fspec = new FilterSpec(filter_str)
            const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

            for (const secret of secrets) {
                const key = output_name || secret.key
                if (seen_keys.has(key)) {
                    console.error(`Error: Duplicate key '${key}' in env.template`)
                    process.exit(1)
                }
                seen_keys.add(key)
                const value = secret.get_value()
                env_lines.push(`${key}="${value}"`)
                console.log(`  ${key}`)
            }
        }

        if (env_lines.length === 0) {
            console.log('No matching secrets found.')
            return
        }

        const env_path = path.join(process.cwd(), '.env')
        fs.writeFileSync(env_path, env_lines.join('\n') + '\n', 'utf-8')
        console.log(`\nWrote ${env_lines.length} variable(s) to .env`)
    })
