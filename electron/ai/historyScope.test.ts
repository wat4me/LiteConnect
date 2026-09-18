import { describe, expect, it } from 'vitest'
import { aiHistoryIdForHost } from './historyScope'

describe('aiHistoryIdForHost', () => {
  it('normalizes DNS host casing and a trailing root dot', () => {
    expect(aiHistoryIdForHost(' Example.COM. ', 22)).toBe('host-v1:22:example.com')
  })

  it('normalizes bracketed IPv6 without losing the address', () => {
    expect(aiHistoryIdForHost('[2001:DB8::1]', 2222)).toBe('host-v1:2222:2001:db8::1')
  })

  it('keeps different SSH ports separate', () => {
    expect(aiHistoryIdForHost('server.local', 22)).not.toBe(aiHistoryIdForHost('server.local', 2222))
  })

  it('rejects an empty host', () => {
    expect(() => aiHistoryIdForHost('  ')).toThrow('Invalid SSH host')
  })
})
