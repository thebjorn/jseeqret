import { Command } from 'commander'
import { SqliteStorage } from '../../core/sqlite-storage.js'
import { FilterSpec } from '../../core/filter.js'
import { InsecureJsonSerializer } from '../../core/serializers/backup.js'
import { require_vault } from '../utils.js'

/**
 * Back up every secret in the vault as plaintext JSON. Intended for
 * disaster recovery only — the output is unencrypted and must be
 * stored with the same care as the original keys.
 *
 * @example
 * jseeqret backup > vault-backup.json
 */
export const backup_command = new Command('backup')
    .description('Backup the entire vault to plaintext JSON')
    .action(async () => {
        require_vault()
        const storage = new SqliteStorage()
        const admin = await storage.fetch_admin()
        const fspec = new FilterSpec('*:*:*')
        const secrets = await storage.fetch_secrets(fspec.to_filter_dict())

        const serializer = new InsecureJsonSerializer({ sender: admin, receiver: admin })
        console.log(serializer.dumps(secrets))
    })
