import { execSync } from 'child_process'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { require_vault } from '../utils.js'

export const setenv_command = new Command('setenv')
    .description('Set Windows environment variables from vault secrets')
    .argument('<filter>', 'Filter spec (app:env:key)')
    .option('--dry-run', 'Show what would be set without making changes')
    .action(async (filter, opts) => {
        require_vault()

        if (process.platform !== 'win32') {
            console.error('Error: setenv is only supported on Windows.')
            process.exit(1)
        }

        const storage = new SqliteStorage()
        const fspec = new FilterSpec(filter)
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        if (secrets.length === 0) {
            console.error(`Error: No secrets found for ${filter}`)
            process.exit(1)
        }

        // Check for duplicate keys
        const keys = secrets.map(s => s.key)
        const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
        if (dupes.length > 0) {
            console.error(`Error: Duplicate keys found: ${[...new Set(dupes)].join(', ')}`)
            for (const s of secrets) {
                if (dupes.includes(s.key)) {
                    console.error(`  ${s.key} from ${s.app}:${s.env}`)
                }
            }
            process.exit(1)
        }

        if (opts.dryRun) {
            for (const secret of secrets) {
                const val = String(secret.get_value())
                console.log(`set "${secret.key}=${val}"`)
            }
            return
        }

        const set_commands = []
        for (const secret of secrets) {
            const val = String(secret.get_value())
            try {
                execSync(`setx ${secret.key} "${val}"`, { stdio: 'pipe' })
                console.log(`  Set: ${secret.key}`)
                set_commands.push(`set "${secret.key}=${val}"`)
            } catch (e) {
                console.error(`Error setting ${secret.key}: ${e.message}`)
                process.exit(1)
            }
        }

        console.log(`\nSet ${secrets.length} environment variable(s).`)
        console.log('\nNote: setx updates the registry but does not affect the current terminal.')
        console.log('To set in the current terminal, run:\n')
        for (const cmd of set_commands) {
            console.log(`  ${cmd}`)
        }
    })
