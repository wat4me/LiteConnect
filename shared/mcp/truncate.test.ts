import { describe, expect, it } from 'vitest'
import { capCollectedStream, capExecOutput, redactSecrets, truncateText } from './truncate'

describe('truncateText', () => {
  it('leaves short text alone', () => {
    expect(truncateText('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })

  it('marks overflow', () => {
    const r = truncateText('abcdefghijklmnopqrstuvwxyz', 20)
    expect(r.truncated).toBe(true)
    expect(r.text.endsWith('[truncated]\n')).toBe(true)
    expect(r.text.length).toBe(20)
  })
})

describe('redactSecrets', () => {
  it('redacts private keys, tokens, and password assignments', () => {
    const raw = [
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      'AKIAIOSFODNN7EXAMPLE',
      'Authorization: Bearer supersecrettokenvalue',
      'password=hunter2',
    ].join('\n')
    const out = redactSecrets(raw)
    expect(out).not.toContain('BEGIN OPENSSH')
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(out).not.toContain('supersecrettokenvalue')
    expect(out).not.toContain('hunter2')
    expect(out).toContain('[redacted')
  })
})

describe('capExecOutput', () => {
  it('redacts then truncates both streams', () => {
    const r = capExecOutput('password=secret ' + 'x'.repeat(50), 'y'.repeat(50), {
      stdout: 30,
      stderr: 20,
    })
    expect(r.truncated).toBe(true)
    expect(r.stdout).not.toContain('secret')
    expect(r.stdout.length).toBeLessThanOrEqual(30)
    expect(r.stderr.length).toBeLessThanOrEqual(20)
  })
})

describe('capCollectedStream', () => {
  it('stops appending after the hard cap', () => {
    const first = capCollectedStream('', 'abcd', 6)
    expect(first).toEqual({ text: 'abcd', truncated: false })
    const second = capCollectedStream(first.text, 'efgh', 6)
    expect(second.truncated).toBe(true)
    expect(second.text).toBe('abcdef')
  })
})
