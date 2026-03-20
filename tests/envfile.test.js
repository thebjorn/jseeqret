import { describe, it, expect } from 'vitest'
import { parse_env } from '../src/core/envfile.js'

describe('parse_env', () => {
    it('parses simple KEY=value lines', () => {
        const result = parse_env('FOO=bar\nBAZ=qux')
        expect(result).toEqual([
            { key: 'FOO', value: 'bar' },
            { key: 'BAZ', value: 'qux' },
        ])
    })

    it('strips double quotes from values', () => {
        const result = parse_env('KEY="hello world"')
        expect(result).toEqual([{ key: 'KEY', value: 'hello world' }])
    })

    it('strips single quotes from values', () => {
        const result = parse_env("KEY='hello world'")
        expect(result).toEqual([{ key: 'KEY', value: 'hello world' }])
    })

    it('handles export prefix', () => {
        const result = parse_env('export SECRET=abc123')
        expect(result).toEqual([{ key: 'SECRET', value: 'abc123' }])
    })

    it('skips comment lines', () => {
        const result = parse_env('# this is a comment\nKEY=val')
        expect(result).toEqual([{ key: 'KEY', value: 'val' }])
    })

    it('skips blank lines', () => {
        const result = parse_env('\n\nKEY=val\n\n')
        expect(result).toEqual([{ key: 'KEY', value: 'val' }])
    })

    it('skips lines without equals sign', () => {
        const result = parse_env('not a valid line\nKEY=val')
        expect(result).toEqual([{ key: 'KEY', value: 'val' }])
    })

    it('handles value with equals sign', () => {
        const result = parse_env('URL=http://host?a=1&b=2')
        expect(result).toEqual([{ key: 'URL', value: 'http://host?a=1&b=2' }])
    })

    it('trims whitespace around key and value', () => {
        const result = parse_env('  KEY  =  val  ')
        expect(result).toEqual([{ key: 'KEY', value: 'val' }])
    })

    it('returns empty array for empty input', () => {
        expect(parse_env('')).toEqual([])
    })

    it('returns empty array for comments-only input', () => {
        expect(parse_env('# just a comment\n# another')).toEqual([])
    })

    it('handles export with quoted value', () => {
        const result = parse_env('export DB_URL="postgres://localhost"')
        expect(result).toEqual([{ key: 'DB_URL', value: 'postgres://localhost' }])
    })

    it('handles Windows line endings', () => {
        const result = parse_env('A=1\r\nB=2\r\n')
        expect(result).toEqual([
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
        ])
    })

    it('does not strip mismatched quotes', () => {
        const result = parse_env('KEY="hello\'')
        expect(result).toEqual([{ key: 'KEY', value: '"hello\'' }])
    })
})
