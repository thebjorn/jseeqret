import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { create_test_vault, cleanup_vault, run_command } from './cli-helpers.js'

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
