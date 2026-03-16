import { describe, it, expect } from 'vitest'
import { FilterSpec, globToSql, hasGlobChars } from '../src/core/filter.js'

describe('globToSql', () => {
  it('converts * to %', () => {
    expect(globToSql('hello*')).toBe('hello%')
  })

  it('converts ? to _', () => {
    expect(globToSql('he?lo')).toBe('he_lo')
  })

  it('passes through plain strings', () => {
    expect(globToSql('hello')).toBe('hello')
  })
})

describe('hasGlobChars', () => {
  it('detects *', () => {
    expect(hasGlobChars('hello*')).toBe(true)
  })

  it('detects ?', () => {
    expect(hasGlobChars('he?lo')).toBe(true)
  })

  it('detects .', () => {
    expect(hasGlobChars('hello.world')).toBe(true)
  })

  it('returns false for plain strings', () => {
    expect(hasGlobChars('hello')).toBe(false)
  })
})

describe('FilterSpec', () => {
  describe('parsing', () => {
    it('single part = key only', () => {
      const f = new FilterSpec('FOO')
      expect(f.app).toBe('*')
      expect(f.env).toBe('*')
      expect(f.name).toBe('FOO')
    })

    it('two parts = app:env', () => {
      const f = new FilterSpec('myapp:prod')
      expect(f.app).toBe('myapp')
      expect(f.env).toBe('prod')
      expect(f.name).toBe('*')
    })

    it('three parts = app:env:key', () => {
      const f = new FilterSpec('myapp:prod:DB_PASS')
      expect(f.app).toBe('myapp')
      expect(f.env).toBe('prod')
      expect(f.name).toBe('DB_PASS')
    })

    it('empty parts default to *', () => {
      const f = new FilterSpec('::FOO')
      expect(f.app).toBe('*')
      expect(f.env).toBe('*')
      expect(f.name).toBe('FOO')
    })

    it('all empty = all wildcard', () => {
      const f = new FilterSpec('::')
      expect(f.app).toBe('*')
      expect(f.env).toBe('*')
      expect(f.name).toBe('*')
    })

    it('single * = key wildcard', () => {
      const f = new FilterSpec('*')
      expect(f.app).toBe('*')
      expect(f.env).toBe('*')
      expect(f.name).toBe('*')
    })
  })

  describe('toFilterDict', () => {
    it('maps name to key', () => {
      const f = new FilterSpec('myapp:prod:DB_*')
      expect(f.toFilterDict()).toEqual({
        app: 'myapp',
        env: 'prod',
        key: 'DB_*',
      })
    })
  })

  describe('matches', () => {
    it('matches exact', () => {
      const f = new FilterSpec('myapp:prod:DB_PASS')
      expect(f.matches(['myapp', 'prod', 'DB_PASS'])).toBe(true)
      expect(f.matches(['myapp', 'prod', 'OTHER'])).toBe(false)
    })

    it('matches wildcard *', () => {
      const f = new FilterSpec('myapp:*:DB_*')
      expect(f.matches(['myapp', 'prod', 'DB_PASS'])).toBe(true)
      expect(f.matches(['myapp', 'dev', 'DB_HOST'])).toBe(true)
      expect(f.matches(['myapp', 'dev', 'API_KEY'])).toBe(false)
    })

    it('matches wildcard ?', () => {
      const f = new FilterSpec('::DB_?ASS')
      expect(f.matches(['x', 'y', 'DB_PASS'])).toBe(true)
      expect(f.matches(['x', 'y', 'DB_MASS'])).toBe(true)
      expect(f.matches(['x', 'y', 'DB_XPASS'])).toBe(false)
    })

    it('all wildcards matches everything', () => {
      const f = new FilterSpec('*')
      expect(f.matches(['any', 'thing', 'here'])).toBe(true)
    })
  })

  describe('toString', () => {
    it('reconstructs the filter', () => {
      const f = new FilterSpec('myapp:prod:DB_*')
      expect(f.toString()).toBe('myapp:prod:DB_*')
    })
  })
})
