import { describe, it, expect } from 'vitest'
import { parse_env } from '../src/core/envfile.js'

describe('parse_env', () => {
    it('parses simple KEY=value', () => {
        expect(parse_env('FOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('parses double-quoted values', () => {
        expect(parse_env('FOO="bar baz"')).toEqual([{ key: 'FOO', value: 'bar baz' }])
    })

    it('parses single-quoted values', () => {
        expect(parse_env("FOO='bar baz'")).toEqual([{ key: 'FOO', value: 'bar baz' }])
    })

    it('handles export prefix', () => {
        expect(parse_env('export FOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('skips comments', () => {
        expect(parse_env('# this is a comment\nFOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('skips empty lines', () => {
        expect(parse_env('\n\nFOO=bar\n\n')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('skips lines without =', () => {
        expect(parse_env('no-equals-here\nFOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('parses multiple entries', () => {
        const text = 'A=1\nB=2\nC=3'
        const result = parse_env(text)
        expect(result).toHaveLength(3)
        expect(result[0]).toEqual({ key: 'A', value: '1' })
        expect(result[1]).toEqual({ key: 'B', value: '2' })
        expect(result[2]).toEqual({ key: 'C', value: '3' })
    })

    it('handles value with equals sign', () => {
        expect(parse_env('FOO=bar=baz')).toEqual([{ key: 'FOO', value: 'bar=baz' }])
    })

    it('handles empty value', () => {
        expect(parse_env('FOO=')).toEqual([{ key: 'FOO', value: '' }])
    })

    it('handles empty quoted value', () => {
        expect(parse_env('FOO=""')).toEqual([{ key: 'FOO', value: '' }])
    })

    it('trims whitespace around key and value', () => {
        expect(parse_env('  FOO  =  bar  ')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('handles export with extra spaces', () => {
        expect(parse_env('export  FOO=bar')).toEqual([{ key: 'FOO', value: 'bar' }])
    })

    it('returns empty array for empty input', () => {
        expect(parse_env('')).toEqual([])
    })

    it('returns empty array for only comments', () => {
        expect(parse_env('# comment\n# another')).toEqual([])
    })

    it('handles Windows line endings', () => {
        expect(parse_env('FOO=bar\r\nBAZ=qux')).toEqual([
            { key: 'FOO', value: 'bar' },
            { key: 'BAZ', value: 'qux' },
        ])
    })

    it('handles mixed comment and export lines', () => {
        const text = `# Database
export DB_HOST=localhost
DB_PORT=5432
# Cache
REDIS_URL="redis://localhost:6379"
`
        const result = parse_env(text)
        expect(result).toHaveLength(3)
        expect(result[0]).toEqual({ key: 'DB_HOST', value: 'localhost' })
        expect(result[1]).toEqual({ key: 'DB_PORT', value: '5432' })
        expect(result[2]).toEqual({ key: 'REDIS_URL', value: 'redis://localhost:6379' })
    })
})
