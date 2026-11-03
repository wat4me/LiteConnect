import { describe, expect, it, vi } from 'vitest'
import { formatLocalDateTime, localDateLine, localTimeZoneLabel, parseLocalDateTime } from './localTime'

describe('local wall-clock helpers', () => {
  it('round-trips a formatted local time back to the same instant', () => {
    const ms = new Date(2026, 10, 3, 14, 5, 7).getTime()
    expect(parseLocalDateTime(formatLocalDateTime(ms))).toBe(ms)
    expect(formatLocalDateTime(ms)).toMatch(/^2026-11-03 14:05:07 UTC[+-]\d{2}:\d{2}$/)
  })

  it('parses ISO forms with Z or an explicit offset as absolute instants', () => {
    expect(parseLocalDateTime('2026-11-03T08:00Z')).toBe(Date.UTC(2026, 10, 3, 8))
    expect(parseLocalDateTime('2026-11-03T08:00+08:00')).toBe(Date.UTC(2026, 10, 3, 0))
    expect(parseLocalDateTime('2026-11-03T08:00-05:00')).toBe(Date.UTC(2026, 10, 3, 13))
    expect(parseLocalDateTime('2026-11-03T08:00:30.000Z')).toBeUndefined()
  })

  it('rejects malformed, out-of-range and overflowing values', () => {
    for (const text of ['', 'soon', '2026-11-03', '2026-13-01 08:00', '2026-02-30 08:00', '2026-11-03 24:00',
      '2026-11-03 08:60', '2026-11-03T08:00+15:00', '2026-11-03T08:00Z+01:00']) {
      expect(parseLocalDateTime(text)).toBeUndefined()
    }
  })

  it('states the date and zone for the model without a changing minute hand', () => {
    const line = localDateLine(new Date(2026, 10, 3, 14, 5, 7).getTime())
    expect(line).toContain('2026-11-03')
    expect(line).toContain(localTimeZoneLabel(new Date(2026, 10, 3, 14, 5, 7)))
    expect(line).not.toContain('14:05')
  })

  it('formats the zone label with minutes included', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)
    expect(localTimeZoneLabel(new Date(0))).toBe('UTC+05:30')
    vi.restoreAllMocks()
  })
})
