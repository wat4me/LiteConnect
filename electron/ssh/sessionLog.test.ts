import { describe, expect, it } from 'vitest'
import { sessionLogRelativePath } from './sessionLog'

describe('sessionLogRelativePath', () => {
  it('builds <day>/<sessionId>-<host>-<port>.log', () => {
    const path = sessionLogRelativePath(
      'abc',
      '10.0.0.1',
      22,
      new Date(2026, 7, 21, 9, 30),
    )
    expect(path).toBe(joinExpected('2026-08-21', 'abc-10.0.0.1-22.log'))
  })

  it('sanitizes unsafe host characters and caps length', () => {
    const path = sessionLogRelativePath(
      'sid',
      'ho:st/..\\x*y?z'.repeat(10),
      2222,
      new Date(2026, 0, 2),
    )
    const file = path.split(/[\\/]/)[1]
    expect(path.split(/[\\/]/)[0]).toBe('2026-01-02')
    expect(file).toMatch(/^sid-[A-Za-z0-9._-]{1,64}-2222\.log$/)
    expect(file).not.toMatch(/[:/\\*?]/)
  })

  it('falls back to unknown for an empty host', () => {
    const path = sessionLogRelativePath('sid', '', 22, new Date(2026, 11, 31))
    expect(path).toContain('sid-unknown-22.log')
  })
})

function joinExpected(day: string, file: string): string {
  return `${day}/${file}`.replace(/\//g, process.platform === 'win32' ? '\\' : '/')
}
