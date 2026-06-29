import { describe, it, expect } from 'vitest'
import {
    slack_preflight_problems,
    assert_slack_ready,
} from '../src/core/slack/session.js'

const now = Math.floor(Date.now() / 1000)

function ready_snap(overrides = {}) {
    return {
        user_token: 'xoxp-token',
        channel_id: 'C1',
        token_created_at: now,
        mfa_attested_at: now,
        ...overrides,
    }
}

describe('slack_preflight_problems', () => {
    it('returns empty for a healthy session', () => {
        expect(slack_preflight_problems(ready_snap())).toEqual([])
    })

    it('flags a missing token', () => {
        const p = slack_preflight_problems(ready_snap({ user_token: null }))
        expect(p.join(' ')).toMatch(/logged in/)
    })

    it('flags a missing channel', () => {
        const p = slack_preflight_problems(ready_snap({ channel_id: null }))
        expect(p.join(' ')).toMatch(/channel/)
    })

    it('flags an aged token (>90 days)', () => {
        const old = now - 100 * 86400
        const p = slack_preflight_problems(ready_snap({ token_created_at: old }))
        expect(p.join(' ')).toMatch(/token is .* days old/)
    })

    it('flags missing MFA attestation', () => {
        const p = slack_preflight_problems(ready_snap({ mfa_attested_at: null }))
        expect(p.join(' ')).toMatch(/MFA/)
    })

    it('flags a stale MFA attestation', () => {
        const old = now - 100 * 86400
        const p = slack_preflight_problems(ready_snap({ mfa_attested_at: old }))
        expect(p.join(' ')).toMatch(/MFA attestation is .* days old/)
    })
})

describe('assert_slack_ready', () => {
    it('does not throw for a healthy session', () => {
        expect(() => assert_slack_ready(ready_snap())).not.toThrow()
    })

    it('throws fail-closed when not ready (doctor gate)', () => {
        expect(() => assert_slack_ready({ user_token: null }))
            .toThrow(/not ready|logged in/i)
    })
})
