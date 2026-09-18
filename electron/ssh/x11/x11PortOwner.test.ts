import { describe, expect, it } from 'vitest'
import {
  classifyPortOwnerName,
  formatPortOwnerLabel,
  parseNetstatListeningPid,
  parseTasklistCsvImageName,
} from './x11PortOwner'

describe('classifyPortOwnerName', () => {
  it('detects residual X servers', () => {
    expect(classifyPortOwnerName('vcxsrv.exe')).toBe('xserver_residual')
    expect(classifyPortOwnerName('VcXsrv.EXE')).toBe('xserver_residual')
    expect(classifyPortOwnerName('Xming.exe')).toBe('xserver_residual')
    expect(classifyPortOwnerName('C:\\Program Files\\VcXsrv\\vcxsrv.exe')).toBe('xserver_residual')
  })

  it('detects other processes', () => {
    expect(classifyPortOwnerName('chrome.exe')).toBe('other')
    expect(classifyPortOwnerName('node.exe')).toBe('other')
  })

  it('unknown for empty', () => {
    expect(classifyPortOwnerName('')).toBe('unknown')
    expect(classifyPortOwnerName('   ')).toBe('unknown')
  })
})

describe('parseNetstatListeningPid', () => {
  it('parses English LISTENING row', () => {
    const out = `
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1088
  TCP    127.0.0.1:6000         0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:56160        127.0.0.1:6000         TIME_WAIT       0
`
    expect(parseNetstatListeningPid(out, 6000)).toBe(4242)
  })

  it('ignores TIME_WAIT client rows', () => {
    const out = `
  TCP    127.0.0.1:56160        127.0.0.1:6000         TIME_WAIT       0
`
    expect(parseNetstatListeningPid(out, 6000)).toBe(null)
  })

  it('parses IPv6 local address', () => {
    const out = `  TCP    [::]:6000              [::]:0                 LISTENING       99`
    expect(parseNetstatListeningPid(out, 6000)).toBe(99)
  })
})

describe('parseTasklistCsvImageName', () => {
  it('parses CSV NH output', () => {
    const out = `"vcxsrv.exe","4242","Console","1","50,000 K"\r\n`
    expect(parseTasklistCsvImageName(out, 4242)).toBe('vcxsrv.exe')
  })
})

describe('formatPortOwnerLabel', () => {
  it('formats name and pid', () => {
    expect(formatPortOwnerLabel({ pid: 1, name: 'a.exe', kind: 'other' })).toBe('a.exe (PID 1)')
    expect(formatPortOwnerLabel(null)).toBe('')
  })
})
