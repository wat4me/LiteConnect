import { describe, expect, it } from 'vitest'
import {
  buildInspectSegments,
  findInspectMatches,
  inspectMatchDisplay,
  nextInspectMatchIndex,
  prevInspectMatchIndex,
  resetInspectMatchIndex,
} from './inspectJsonSearch'

describe('findInspectMatches', () => {
  it('finds case-insensitive plain matches', () => {
    const text = '{"Name":"MyApp","name":"myapp"}'
    const m = findInspectMatches(text, 'myapp')
    expect(m).toHaveLength(2)
    expect(text.slice(m[0].start, m[0].end)).toBe('MyApp')
    expect(text.slice(m[1].start, m[1].end)).toBe('myapp')
  })

  it('treats regex special characters as literals (no injection)', () => {
    const text = 'value: a.*b+c? and a.*b+c?'
    const m = findInspectMatches(text, 'a.*b+c?')
    expect(m).toHaveLength(2)
    expect(text.slice(m[0].start, m[0].end)).toBe('a.*b+c?')
  })

  it('returns empty for empty query or no match', () => {
    expect(findInspectMatches('{"a":1}', '')).toEqual([])
    expect(findInspectMatches('{"a":1}', '   ')).toEqual([])
    expect(findInspectMatches('{"a":1}', 'zzz')).toEqual([])
    expect(findInspectMatches('', 'a')).toEqual([])
  })

  it('handles overlapping-adjacent non-overlap scan', () => {
    const text = 'aaaa'
    // non-overlapping: "aa" at 0 and 2
    expect(findInspectMatches(text, 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })
})

describe('buildInspectSegments', () => {
  it('returns single text segment when no matches', () => {
    expect(buildInspectSegments('hello', [])).toEqual([{ kind: 'text', text: 'hello' }])
  })

  it('interleaves text and match segments', () => {
    const text = 'abXYcdXYef'
    const matches = findInspectMatches(text, 'xy')
    const segs = buildInspectSegments(text, matches)
    expect(segs).toEqual([
      { kind: 'text', text: 'ab' },
      { kind: 'match', text: 'XY', matchIndex: 0 },
      { kind: 'text', text: 'cd' },
      { kind: 'match', text: 'XY', matchIndex: 1 },
      { kind: 'text', text: 'ef' },
    ])
  })

  it('does not interpret HTML-like content', () => {
    const text = '<script>alert(1)</script>'
    const matches = findInspectMatches(text, 'script')
    const segs = buildInspectSegments(text, matches)
    // segments are plain text only — renderer must use text nodes
    expect(segs.every((s) => typeof s.text === 'string')).toBe(true)
    expect(segs.some((s) => s.kind === 'match' && s.text === 'script')).toBe(true)
  })
})

describe('match navigation', () => {
  it('next/prev wrap around', () => {
    expect(nextInspectMatchIndex(0, 3)).toBe(1)
    expect(nextInspectMatchIndex(2, 3)).toBe(0)
    expect(prevInspectMatchIndex(0, 3)).toBe(2)
    expect(prevInspectMatchIndex(1, 3)).toBe(0)
  })

  it('handles zero matches', () => {
    expect(nextInspectMatchIndex(0, 0)).toBe(0)
    expect(prevInspectMatchIndex(0, 0)).toBe(0)
  })

  it('reset is always first index', () => {
    expect(resetInspectMatchIndex(5)).toBe(0)
    expect(resetInspectMatchIndex(0)).toBe(0)
  })

  it('display is 1-based', () => {
    expect(inspectMatchDisplay(0, 5)).toEqual({ current: 1, total: 5 })
    expect(inspectMatchDisplay(4, 5)).toEqual({ current: 5, total: 5 })
    expect(inspectMatchDisplay(0, 0)).toEqual({ current: 0, total: 0 })
  })
})
