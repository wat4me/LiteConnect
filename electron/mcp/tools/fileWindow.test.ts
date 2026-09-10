import { describe, expect, it } from 'vitest'
import { createLineCollector, prefixLineNumbers, takeCompleteLines } from './fileWindow'

describe('takeCompleteLines', () => {
  it('holds a partial line until a newline or eof', () => {
    expect(takeCompleteLines('', 'hel', false)).toEqual({ lines: [], carry: 'hel' })
    expect(takeCompleteLines('hel', 'lo\nwor', false)).toEqual({ lines: ['hello'], carry: 'wor' })
    expect(takeCompleteLines('wor', 'ld', true)).toEqual({ lines: ['world'], carry: '' })
  })

  it('drops a trailing newline at eof instead of an extra empty line', () => {
    expect(takeCompleteLines('', 'a\nb\n', true)).toEqual({ lines: ['a', 'b'], carry: '' })
  })
})

describe('createLineCollector', () => {
  it('returns the first N lines and reports the next start line', () => {
    const c = createLineCollector({ startLine: 1, limit: 2, maxBytes: 10_000, maxLineChars: 80 })
    c.push('one\ntwo\nthree\n', true)
    const r = c.result()
    expect(r.lines).toEqual(['one', 'two'])
    expect(r.nextLine).toBe(3)
    expect(r.hitLineCap).toBe(true)
    expect(r.hitByteCap).toBe(false)
  })

  it('skips ahead to startLine', () => {
    const c = createLineCollector({ startLine: 3, limit: 2, maxBytes: 10_000, maxLineChars: 80 })
    c.push('a\nb\nc\nd\ne\n', true)
    expect(c.result().lines).toEqual(['c', 'd'])
    expect(c.result().nextLine).toBe(5)
  })

  it('stops a single huge line without a newline before buffering the whole file', () => {
    const c = createLineCollector({ startLine: 1, limit: 50, maxBytes: 32, maxLineChars: 2000 })
    c.push('x'.repeat(20), false)
    c.push('y'.repeat(20), false)
    expect(c.stopped).toBe(true)
    expect(c.result().hitByteCap).toBe(true)
    expect(c.result().lines[0].length).toBeLessThanOrEqual(32)
  })

  it('clips long lines and stops at the byte budget', () => {
    const c = createLineCollector({ startLine: 1, limit: 50, maxBytes: 20, maxLineChars: 8 })
    c.push(`${'x'.repeat(40)}\nshort\n`, true)
    const r = c.result()
    expect(r.clippedLine).toBe(true)
    expect(r.lines[0].endsWith('…')).toBe(true)
    expect(r.lines[0].length).toBeLessThanOrEqual(8)
  })
})

describe('prefixLineNumbers', () => {
  it('right-aligns the number and uses a tab', () => {
    expect(prefixLineNumbers(['a', 'b', 'c'], 1)).toBe('1\ta\n2\tb\n3\tc')
  })

  it('pads to the width of the last line number', () => {
    expect(prefixLineNumbers(['x'], 99)).toBe('99\tx')
    expect(prefixLineNumbers(['a', 'b'], 99)).toBe(' 99\ta\n100\tb')
  })

  it('keeps absolute numbering when paging from an offset', () => {
    expect(prefixLineNumbers(['a', 'b'], 200)).toBe('200\ta\n201\tb')
  })

  it('preserves leading whitespace in the content', () => {
    expect(prefixLineNumbers(['  indented'], 1)).toBe('1\t  indented')
  })

  it('returns an empty string for no lines', () => {
    expect(prefixLineNumbers([], 1)).toBe('')
  })
})
