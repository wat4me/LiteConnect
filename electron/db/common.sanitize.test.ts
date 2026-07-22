import { describe, expect, it } from 'vitest'
import { sanitizeCancelError } from './common'

describe('sanitizeCancelError', () => {
  it('redacts password= and userinfo in URLs', () => {
    const s = sanitizeCancelError('fail password=secret123 host=x')
    expect(s).not.toContain('secret123')
    expect(s).toMatch(/password=\*\*\*/i)

    const u = sanitizeCancelError('connect://user:pass@host/db failed')
    expect(u).not.toContain('user:pass@')
    expect(u).toContain('://***@')
  })

  it('truncates long messages', () => {
    const long = 'x'.repeat(300)
    const s = sanitizeCancelError(long)
    expect(s.length).toBeLessThanOrEqual(201)
  })
})
