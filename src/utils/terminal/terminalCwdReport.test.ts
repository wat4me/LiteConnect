import { describe, expect, it } from 'vitest'
import { parseTerminalCwdReport } from './terminalCwdReport'

describe('parseTerminalCwdReport', () => {
  it('decodes the URI while preserving the logical path and encoded delimiters', () => {
    expect(parseTerminalCwdReport('file://server/home/link/a%20b%23%3F')).toEqual({
      host: 'server', path: '/home/link/a b#?',
    })
    expect(parseTerminalCwdReport('file:///')).toEqual({ host: '', path: '/' })
  })

  it.each(['https://server/home', 'file:///home/%ZZ', 'file:///home/%00', 'file:///home#fragment'])(
    'ignores malformed or unsupported cwd report %s',
    report => expect(parseTerminalCwdReport(report)).toBeUndefined(),
  )
})
