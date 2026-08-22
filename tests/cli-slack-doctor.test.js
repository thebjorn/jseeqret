import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { create_test_vault, cleanup_vault, run_command } from './cli-helpers.js'
import { SqliteStorage } from '../src/core/sqlite-storage.js'
import { User } from '../src/core/models/user.js'
import { generate_key_pair, encode_key } from '../src/core/crypto/nacl.js'
import { bind_slack_handle } from '../src/core/slack/identity.js'

// Regression coverage for `slack doctor --accept`. The action used to read
// a single config snapshot up front, evaluate every check against it, and
// only *afterward* apply the --accept writes -- so the run that recorded
// the MFA attestation still reported it failing, and a second identical
// run was needed to observe the persisted value. These tests lock in the
// single-run behavior.
//
// A vault with no Slack token is used deliberately: the connected-apps
// check (the only network-touching branch) is then skipped, keeping these
// tests hermetic. The MFA attestation -- which shares the exact same
// write-before-read fix -- is fully offline and stands in as the witness.

let tmp_dir

const MFA_LABEL = /workspace SSO \+ hardware MFA attested/

beforeEach(async () => {
    ;({ tmp_dir } = await create_test_vault())
})

afterEach(() => {
    cleanup_vault(tmp_dir)
})

describe('CLI: slack doctor --accept', () => {
    it('records and reports the MFA attestation in a single run', () => {
        const r = run_command(['slack', 'doctor', '--accept'], {
            vault_dir: tmp_dir,
            input: 'yes\n',
        })
        expect(r.stdout).toContain('MFA attestation recorded.')
        // The freshly-written attestation must be visible to the same run.
        expect(r.stdout).toMatch(
            new RegExp(`\\[ok\\][^\\n]*${MFA_LABEL.source}`)
        )
        // Pre-fix this line read [FAIL] -- guard against the regression.
        expect(r.stdout).not.toMatch(
            new RegExp(`\\[FAIL\\][^\\n]*${MFA_LABEL.source}`)
        )
    })

    it('reports MFA as failing on a fresh vault without --accept', () => {
        const r = run_command(['slack', 'doctor'], { vault_dir: tmp_dir })
        expect(r.stdout).toMatch(
            new RegExp(
                `\\[FAIL\\][^\\n]*${MFA_LABEL.source}[^\\n]*re-run with --accept`
            )
        )
    })

    it('does not attest when --accept is declined', () => {
        const r = run_command(['slack', 'doctor', '--accept'], {
            vault_dir: tmp_dir,
            input: 'no\n',
        })
        expect(r.stdout).toContain('MFA attestation NOT recorded.')
        expect(r.stdout).toMatch(
            new RegExp(`\\[FAIL\\][^\\n]*${MFA_LABEL.source}`)
        )
    })
})

describe('CLI: slack doctor fingerprint repair guidance', () => {
    it('prints exact actions for a changed public key', async () => {
        const storage = new SqliteStorage('seeqrets.db', tmp_dir)
        const username =
            'WDAGUtilityAccount@fa4e5104-8c0f-43f8-9d3c-dcc63b1c1eba'
        const original_key = generate_key_pair()
        await storage.add_user(new User(
            username,
            'sandbox@test.com',
            encode_key(original_key.publicKey),
        ))
        await bind_slack_handle(storage, username, 'sandbox-user')

        // Simulate an unverified key rotation. update_user() deliberately
        // clears the old binding, so write directly to cover malicious or
        // legacy database drift detected by doctor.
        const replacement_key = generate_key_pair()
        await storage._with_db((db) => {
            db.run('UPDATE users SET pubkey = ? WHERE username = ?', [
                encode_key(replacement_key.publicKey), username,
            ])
        }, true)

        const r = run_command(['slack', 'doctor'], { vault_dir: tmp_dir })

        expect(r.exit_code).toBe(1)
        expect(r.stdout).toContain(
            `${username}: public key changed after Slack verification`
        )
        expect(r.stdout).toMatch(/stored fingerprint: [0-9a-f]{5}/)
        expect(r.stdout).toMatch(/current fingerprint: [0-9a-f]{5}/)
        expect(r.stdout).toContain(
            `jseeqret slack link "${username}" --handle sandbox-user`
        )
        expect(r.stdout).toContain(`jseeqret rm user "${username}"`)
    })
})
