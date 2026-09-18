import { describe, expect, it } from 'vitest'
import { normalizeConnectionSortMode } from './connectionSort'

describe('normalizeConnectionSortMode', () => {
  it.each(['manual', 'recent', 'frequent'] as const)('retains %s', (mode) => {
    expect(normalizeConnectionSortMode(mode)).toBe(mode)
  })

  it('falls back to manual for invalid persisted data', () => {
    expect(normalizeConnectionSortMode('newest')).toBe('manual')
    expect(normalizeConnectionSortMode(null)).toBe('manual')
  })

  it('disables stats-based sorting when usage statistics are off', () => {
    expect(normalizeConnectionSortMode('recent', false)).toBe('manual')
    expect(normalizeConnectionSortMode('frequent', false)).toBe('manual')
  })
})
