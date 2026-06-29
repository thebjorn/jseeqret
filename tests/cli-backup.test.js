import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
    create_test_vault, cleanup_vault, run_command,
} from './cli-helpers.js'

let tmp_dir

beforeEach(async () => {
    const vault = await create_test_vault()
    tmp_dir = vault.tmp_dir
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: backup (encrypted)', () => {
    it('writes a self-decrypting HTML file with no plaintext secrets', () => {
        run_command([
            'add', 'key', 'DB_PASSWORD', 'super-secret-value',
        ], { vault_dir: tmp_dir })

        const out = join(tmp_dir, 'backup.html')
        const result = run_command([
            'backup', '--password', 'pw123', '--out', out,
        ], { vault_dir: tmp_dir })

        expect(result.exit_code).toBe(0)
        expect(existsSync(out)).toBe(true)

        const html = readFileSync(out, 'utf-8')
        // the self-decrypting viewer is embedded
        expect(html).toContain('id="vault"')
        expect(html).toContain('crypto.subtle')
        // the plaintext secret value must never appear in the output
        expect(html).not.toContain('super-secret-value')
    })
})
