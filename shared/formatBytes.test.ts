import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('formats each unit with compact rounding', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(800)).toBe('800 B')
    expect(formatBytes(1.5 * 1024)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024)).toBe('12 KB')
    expect(formatBytes(15.2 * 1024 * 1024)).toBe('15 MB')
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})
