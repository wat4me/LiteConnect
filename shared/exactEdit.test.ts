import { describe, expect, it } from 'vitest'
import { applyExactEdit, countOccurrences } from './exactEdit'

describe('countOccurrences', () => {
  it('counts non-overlapping literal matches', () => {
    expect(countOccurrences('aaaa', 'aa')).toBe(2)
    expect(countOccurrences('abcabc', 'abc')).toBe(2)
    expect(countOccurrences('abc', 'z')).toBe(0)
    expect(countOccurrences('abc', '')).toBe(0)
  })
})

describe('applyExactEdit', () => {
  it('replaces the single occurrence', () => {
    const out = applyExactEdit('a\nb\nc\n', 'b', 'B')
    expect(out).toEqual({ ok: true, text: 'a\nB\nc\n', replaced: 1 })
  })

  it('rejects an empty search', () => {
    const out = applyExactEdit('abc', '', 'x')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('EMPTY_SEARCH')
  })

  it('rejects a no-op edit', () => {
    const out = applyExactEdit('abc', 'b', 'b')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('NO_OP')
  })

  it('reports a missing target with actionable guidance', () => {
    const out = applyExactEdit('abc', 'zz', 'x')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('NOT_FOUND')
      expect(out.hint).toContain('read_file')
      expect(out.hint).toContain('line-number prefix')
    }
  })

  it('explains a CRLF mismatch when the search used bare LF', () => {
    const out = applyExactEdit('a\r\nb\r\n', 'a\nb', 'x')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.hint).toContain('CRLF')

    const matching = applyExactEdit('a\r\nb\r\n', 'a\r\nb', 'x')
    expect(matching.ok).toBe(true)
  })

  it('does not mention CRLF for an LF-only file', () => {
    const out = applyExactEdit('a\nb\n', 'nope', 'x')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.hint).not.toContain('CRLF')
  })

  it('refuses an ambiguous target unless replaceAll is set', () => {
    const out = applyExactEdit('listen 80\nlisten 80\n', 'listen 80', 'listen 8080')
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('NOT_UNIQUE')
      expect(out.occurrences).toBe(2)
      expect(out.hint).toContain('replaceAll=true')
    }
  })

  it('replaces every occurrence when replaceAll is set', () => {
    const out = applyExactEdit('listen 80\nlisten 80\n', 'listen 80', 'listen 8080', true)
    expect(out).toEqual({ ok: true, text: 'listen 8080\nlisten 8080\n', replaced: 2 })
  })

  it('keeps a literal $ in the replacement instead of expanding it', () => {
    const out = applyExactEdit('key=OLD\n', 'OLD', '$1&$`')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text).toBe('key=$1&$`\n')
  })

  it('uses the first occurrence when replaceAll is false', () => {
    const out = applyExactEdit('x\nx\n', 'x', 'y')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('NOT_UNIQUE')

    const single = applyExactEdit('x\ny\n', 'x', 'z')
    expect(single).toEqual({ ok: true, text: 'z\ny\n', replaced: 1 })
  })

  it('edits multi-line blocks with exact indentation', () => {
    const content = 'server {\n  listen 80;\n}\n'
    const out = applyExactEdit(content, '  listen 80;', '  listen 8080;\n  server_name a.b;')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.text).toBe('server {\n  listen 8080;\n  server_name a.b;\n}\n')
  })
})
