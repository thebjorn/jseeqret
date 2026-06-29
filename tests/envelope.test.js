import { describe, it, expect } from 'vitest'
import {
    ENVELOPE_VERSION,
    MESSAGE_KINDS,
    wrap_envelope,
    parse_envelope,
} from '../src/core/serializers/envelope.js'

describe('envelope wrap/parse', () => {
    it('round-trips every message kind', () => {
        for (const kind of Object.values(MESSAGE_KINDS)) {
            const payload = { hello: 'world', kind_echo: kind, n: 42 }
            const text = wrap_envelope(kind, payload)
            const parsed = parse_envelope(text)
            expect(parsed.kind).toBe(kind)
            expect(parsed.payload).toEqual(payload)
            expect(parsed.version).toBe(ENVELOPE_VERSION)
        }
    })

    it('wrap produces a { v, kind, payload } object', () => {
        const text = wrap_envelope(MESSAGE_KINDS.introduction, { a: 1 })
        const raw = JSON.parse(text)
        expect(raw.v).toBe(ENVELOPE_VERSION)
        expect(raw.kind).toBe('introduction')
        expect(raw.payload).toEqual({ a: 1 })
    })

    it('a legacy untyped secret blob decodes as kind "secret"', () => {
        // The shape json-crypt.dumps() produced before envelopes existed.
        const legacy = JSON.stringify({
            version: 1,
            from: 'alice',
            to: 'bob',
            secrets: [{ app: 'a', env: 'e', key: 'K', value: 'xx', type: 'str' }],
            signature: 'abcde',
        })
        const parsed = parse_envelope(legacy)
        expect(parsed.kind).toBe(MESSAGE_KINDS.secret)
        expect(parsed.version).toBeNull()
        expect(parsed.payload.from).toBe('alice')
        expect(parsed.payload.secrets).toHaveLength(1)
    })

    it('parse throws on non-JSON', () => {
        expect(() => parse_envelope('not json at all')).toThrow()
    })
})
