import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { create_test_vault, cleanup_vault, run_command } from './cli-helpers.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { User } from '../src/core/models/user.js'
import { qualified_user } from '../src/core/vault.js'

let tmp_dir

beforeEach(async () => {
    ;({ tmp_dir } = await create_test_vault())
    // Register the OS-qualified user so `fetch_self` succeeds and the
    // Slack-touching subcommands reach the fail-closed Slack gate.
    const storage = new SqliteStorage('seeqrets.db', tmp_dir)
    await storage.add_user(new User(qualified_user(), 'me@test.com', 'AA=='))
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: onboard', () => {
    it('onboard --help lists every subcommand', () => {
        const r = run_command(['onboard', '--help'], { vault_dir: tmp_dir })
        expect(r.exit_code).toBe(0)
        for (const sub of ['invite', 'status', 'watch', 'join', 'receive', 'approve']) {
            expect(r.stdout).toContain(sub)
        }
    })

    it('onboard status reports an empty vault', () => {
        const r = run_command(['onboard', 'status'], { vault_dir: tmp_dir })
        expect(r.exit_code).toBe(0)
        expect(r.stdout).toContain('No onboardings in progress')
    })

    it('onboard invite fails closed when Slack is not configured', () => {
        const r = run_command(
            ['onboard', 'invite', '--email', 'x@t.com', '--project', 'a:*:*'],
            { vault_dir: tmp_dir }
        )
        expect(r.exit_code).toBe(1)
        expect(r.stderr).toMatch(/not ready|logged in|slack/i)
    })

    it('onboard approve fails closed when Slack is not configured', () => {
        const r = run_command(['onboard', 'approve', 'x@t.com'], { vault_dir: tmp_dir })
        expect(r.exit_code).toBe(1)
        expect(r.stderr).toMatch(/not ready|logged in|slack/i)
    })
})
