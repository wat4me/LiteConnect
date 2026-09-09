import { describe, expect, it } from 'vitest'
import {
  buildGlobCommand,
  buildGrepCommand,
  parseGrepLine,
  parseGrepOutput,
  sanitizeIncludeGlob,
  sanitizeSearchPattern,
} from './search'

describe('search helpers', () => {
  it('quotes rg/grep commands and keeps a simple include glob', () => {
    expect(buildGrepCommand({ engine: 'rg', pattern: 'error', path: '/var/log', include: '*.log' })).toContain(
      "rg -n -H --no-heading",
    )
    expect(buildGrepCommand({ engine: 'grep', pattern: "it's", path: '/etc' })).toContain("'\\''")
    expect(buildGlobCommand({ engine: 'rg', path: '/etc', pattern: '*.conf' })).toContain('rg --files')
    expect(buildGlobCommand({ engine: 'find', path: '/etc', pattern: '*.conf' })).toContain('find')
  })

  it('parses rg -H lines and caps match count', () => {
    expect(parseGrepLine('/var/log/app.log:12:disk full')).toEqual({
      path: '/var/log/app.log',
      line: 12,
      text: 'disk full',
    })
    const rows = Array.from({ length: 120 }, (_, i) => `/tmp/a:${i + 1}:x`).join('\n')
    expect(parseGrepOutput(rows)).toHaveLength(100)
  })

  it('rejects empty or multiline patterns', () => {
    expect(() => sanitizeSearchPattern('')).toThrow(/pattern is required/)
    expect(() => sanitizeSearchPattern('a\nb')).toThrow(/single line/)
    expect(sanitizeIncludeGlob('**/*.log')).toBe('**/*.log')
    expect(() => sanitizeIncludeGlob('*.log; rm -rf /')).toThrow(/simple glob/)
  })
})
