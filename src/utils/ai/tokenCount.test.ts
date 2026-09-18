import { describe, expect, it } from 'vitest'
import { formatCompactTokenCount } from './tokenCount'

describe('formatCompactTokenCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1k'],
    [14_191, '14.2k'],
    [125_000, '125k'],
    [1_250_000, '1.3M'],
  ])('formats %i as %s', (value, expected) => {
    expect(formatCompactTokenCount(value)).toBe(expected)
  })
})
