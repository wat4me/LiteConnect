import { describe, expect, it } from 'vitest'
import {
  bearerMatches,
  hostnameFromHostHeader,
  isAllowedHostHeader,
  isAllowedOrigin,
  SlidingWindowLimiter,
} from './httpAuth'

describe('httpAuth', () => {
  it('accepts loopback Host headers with ports', () => {
    expect(hostnameFromHostHeader('127.0.0.1:17420')).toBe('127.0.0.1')
    expect(hostnameFromHostHeader('localhost:17420')).toBe('localhost')
    expect(hostnameFromHostHeader('[::1]:17420')).toBe('::1')
    expect(isAllowedHostHeader('127.0.0.1:17420')).toBe(true)
    expect(isAllowedHostHeader('evil.example:17420')).toBe(false)
    expect(isAllowedHostHeader(undefined)).toBe(false)
  })

  it('allows missing Origin and rejects non-loopback Origin', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true)
    expect(isAllowedOrigin('https://evil.example')).toBe(false)
  })

  it('compares bearer tokens in constant time and rejects mismatches', () => {
    const token = 'a'.repeat(64)
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true)
    expect(bearerMatches(`Bearer ${'b'.repeat(64)}`, token)).toBe(false)
    expect(bearerMatches('Basic abc', token)).toBe(false)
    expect(bearerMatches(`Bearer ${token}`, '')).toBe(false)
  })

  it('rate-limits a sliding window', () => {
    const limiter = new SlidingWindowLimiter(2, 1000)
    expect(limiter.allow(1000)).toBe(true)
    expect(limiter.allow(1000)).toBe(true)
    expect(limiter.allow(1000)).toBe(false)
    expect(limiter.allow(2001)).toBe(true)
  })
})
