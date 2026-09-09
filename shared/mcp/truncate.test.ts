import { describe, expect, it } from 'vitest'
import { capCollectedStream, capExecOutput, truncateText } from './truncate'

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

describe('capExecOutput', () => {
  it('truncates both streams and keeps the original text', () => {
    const r = capExecOutput('password=secret ' + 'x'.repeat(50), 'y'.repeat(50), {
      stdout: 30,
      stderr: 20,
    })
    expect(r.truncated).toBe(true)
    expect(r.stdout.startsWith('password=secret')).toBe(true)
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
