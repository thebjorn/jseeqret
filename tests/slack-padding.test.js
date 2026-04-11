import { describe, it, expect } from 'vitest'
import { pad_to_bucket, unpad_from_bucket, DEFAULT_BUCKET } from '../src/core/slack/padding.js'

describe('slack padding', () => {
    it('round-trips an empty payload', () => {
        const payload = Buffer.alloc(0)
        const padded = pad_to_bucket(payload)
        expect(padded.length).toBe(DEFAULT_BUCKET)
        expect(unpad_from_bucket(padded)).toEqual(payload)
    })

    it('round-trips a short payload', () => {
        const payload = Buffer.from('hello slack', 'utf-8')
        const padded = pad_to_bucket(payload)
        expect(padded.length).toBe(DEFAULT_BUCKET)
        expect(unpad_from_bucket(padded).toString('utf-8')).toBe('hello slack')
    })

    it('pads to the next bucket for a medium payload', () => {
        const payload = Buffer.alloc(5000, 0xAB)
        const padded = pad_to_bucket(payload)
        // 4 + 5000 = 5004, next multiple of 4096 is 8192
        expect(padded.length).toBe(8192)
        expect(unpad_from_bucket(padded).equals(payload)).toBe(true)
    })

    it('round-trips a payload that exactly fills a bucket', () => {
        // Choose N so that 4 + N is a multiple of 4096
        const N = 4096 * 2 - 4
        const payload = Buffer.alloc(N, 0x11)
        const padded = pad_to_bucket(payload)
        expect(padded.length).toBe(4096 * 2)
        expect(unpad_from_bucket(padded).equals(payload)).toBe(true)
    })

    it('rejects a truncated blob', () => {
        expect(() => unpad_from_bucket(Buffer.from([1, 2, 3]))).toThrow()
    })

    it('rejects a blob whose length prefix is absurd', () => {
        const bad = Buffer.alloc(100)
        bad.writeUInt32BE(999999, 0)
        expect(() => unpad_from_bucket(bad)).toThrow()
    })

    it('accepts a custom bucket size', () => {
        const payload = Buffer.from('x')
        const padded = pad_to_bucket(payload, 64)
        expect(padded.length).toBe(64)
        expect(unpad_from_bucket(padded).equals(payload)).toBe(true)
    })
})
