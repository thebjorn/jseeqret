import fs from 'fs'
import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { Secret } from '../../core/models/secret.js'
import { parse_env } from '../../core/envfile.js'
import { require_vault } from '../utils.js'

export const importenv_command = new Command('importenv')
    .description('Import secrets from a .env file')
    .argument('<file>', 'Path to .env file')
    .option('--app <app>', 'Application name for imported secrets', '*')
    .option('--env <env>', 'Environment name for imported secrets', '*')
    .option('--update', 'Update existing secrets instead of skipping')
    .option('--dry-run', 'Show what would be imported without making changes')
    .action(async (file, opts) => {
        require_vault()

        if (!fs.existsSync(file)) {
            console.error(`Error: File not found: ${file}`)
            process.exit(1)
        }

        const text = fs.readFileSync(file, 'utf-8')
        const entries = parse_env(text)

        if (entries.length === 0) {
            console.log('No entries found in file.')
            return
        }

        const storage = new SqliteStorage()
        let added = 0, updated = 0, skipped = 0

        for (const { key, value } of entries) {
            if (key.includes(':')) {
                console.error(`Error: Key '${key}' contains ':' which is not allowed.`)
                process.exit(1)
            }

            if (opts.dryRun) {
                const truncated = value.length > 20 ? value.slice(0, 20) + '...' : value
                console.log(`  ${key}=${truncated}`)
                continue
            }

            // Check if secret already exists
            const fspec = new FilterSpec(`${opts.app}:${opts.env}:${key}`)
            const existing = await storage.fetch_secrets(fspec.to_filter_dict())

            if (existing.length > 0) {
                if (opts.update) {
                    existing[0].set_value(value)
                    await storage.update_secret(existing[0])
                    console.log(`  Updated: ${key}`)
                    updated++
                } else {
                    console.log(`  Skipped: ${key} (already exists)`)
                    skipped++
                }
            } else {
                const secret = new Secret({
                    app: opts.app,
                    env: opts.env,
                    key,
                    plaintext_value: value,
                    type: 'str',
                })
                await storage.add_secret(secret)
                console.log(`  Added: ${key}`)
                added++
            }
        }

        if (opts.dryRun) {
            console.log(`\nDry run: ${entries.length} entry(ies) would be imported.`)
        } else {
            console.log(`\nImport complete: ${added} added, ${updated} updated, ${skipped} skipped`)
        }
    })
