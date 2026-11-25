import { describe, expect, it } from 'vitest'
import {
  findLineOccurrences,
  normalizeSelectionOccurrenceNeedle,
  type HighlightLineLike,
} from './selectionHighlight'

function makeLine(text: string): HighlightLineLike {
  const cells: Array<{ chars: string; width: number }> = []
  for (const ch of text) {
    const isWide = ch.charCodeAt(0) > 0x2e80
    cells.push({ chars: ch, width: isWide ? 2 : 1 })
    if (isWide) cells.push({ chars: '', width: 0 })
  }
  return {
    length: cells.length,
    getCell: (x: number) => {
      const c = cells[x]
      return c ? { getChars: () => c.chars, getWidth: () => c.width } : undefined
    },
  }
}

describe('selectionHighlight', () => {
  it('filters out empty, single-char, multi-line, and overlong selections', () => {
    expect(normalizeSelectionOccurrenceNeedle('')).toBeNull()
    expect(normalizeSelectionOccurrenceNeedle('   ')).toBeNull()
    expect(normalizeSelectionOccurrenceNeedle('a')).toBeNull()
    expect(normalizeSelectionOccurrenceNeedle('foo\nbar')).toBeNull()
    expect(normalizeSelectionOccurrenceNeedle('x'.repeat(121))).toBeNull()
    expect(normalizeSelectionOccurrenceNeedle('  10.2.178.163  ')).toBe('10.2.178.163')
  })

  it('finds all non-overlapping matches and skips the active selection span', () => {
    const line = makeLine('host 10.0.0.1 -> 10.0.0.1 (retry 10.0.0.1)')
    const matches = findLineOccurrences(line, 5, '10.0.0.1', {
      startX: 5,
      startY: 5,
      endX: 13,
      endY: 5,
    })
    expect(matches).toEqual([
      { x: 17, width: 8 },
      { x: 33, width: 8 },
    ])
  })

  it('computes accurate cell offsets when wide CJK characters precede a match', () => {
    // '错误 ' = 2 + 2 + 1 = 5 cells before 'ERROR'
    const line = makeLine('错误 ERROR 再次 ERROR')
    const matches = findLineOccurrences(line, 0, 'ERROR', null)
    expect(matches).toEqual([
      { x: 5, width: 5 },
      { x: 16, width: 5 },
    ])
  })
})
