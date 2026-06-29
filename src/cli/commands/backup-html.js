import { Command } from 'commander'
import { writeFileSync } from 'fs'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { InsecureJsonSerializer } from '../../core/serializers/backup.js'
import { to_self_decrypting_html } from '../../core/serializers/self-decrypting-html.js'
import { require_vault, read_password } from '../utils.js'

function _default_filename() {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}`
        + `${pad(now.getDate())}-${pad(now.getHours())}`
        + `${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return `jseeqret-backup-${stamp}.html`
}

/**
 * Back up the entire vault to a single password-protected, self-decrypting
 * HTML file. Unlike `backup` (which writes plaintext JSON), the output is
 * encrypted with AES-256-GCM under a PBKDF2-derived key and can be opened
 * in any browser to decrypt locally. Restore by unlocking it, downloading
 * the JSON, and importing that file.
 *
 * @example
 * jseeqret backup-html --out vault.html
 */
export const backup_html_command = new Command('backup-html')
    .description('Back up the vault to a password-protected HTML file')
    .option('-o, --out <file>', 'Output file path')
    .option(
        '--password <password>',
        'Encryption password (prompted if omitted; avoid on shared shells)'
    )
    .action(async (opts) => {
        require_vault()

        let password = opts.password
        if (!password) {
            password = await read_password('Backup password: ')
            const confirm = await read_password('Confirm password: ')
            if (password !== confirm) {
                console.error('Error: passwords do not match.')
                process.exit(1)
            }
        }
        if (!password) {
            console.error('Error: a non-empty password is required.')
            process.exit(1)
        }

        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()
        const fspec = new FilterSpec('*:*:*')
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        const serializer = new InsecureJsonSerializer({
            sender: admin,
            receiver: admin,
        })
        const plaintext = serializer.dumps(secrets)
        const html = await to_self_decrypting_html(plaintext, password)

        const out = opts.out || _default_filename()
        writeFileSync(out, html, 'utf-8')

        console.log(`Wrote ${secrets.length} secrets to ${out}`)
        console.log('Open it in a browser and enter the password to decrypt.')
    })
