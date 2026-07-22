import { describe, expect, it } from 'vitest'
import {
  DualStreamLogAssembler,
  parseDockerLogTimestampLine,
  stripAnsi,
} from './logText'

describe('stripAnsi', () => {
  it('removes CSI sequences without interpreting HTML', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red')
    expect(stripAnsi('<b>x</b>')).toBe('<b>x</b>')
  })
})

describe('parseDockerLogTimestampLine', () => {
  it('parses normal RFC3339Nano prefix', () => {
    const r = parseDockerLogTimestampLine('2024-01-02T03:04:05.123456789Z hello')
    expect(r.timestamp).toBe('2024-01-02T03:04:05.123456789Z')
    expect(r.text).toBe('hello')
  })

  it('missing timestamp keeps full text', () => {
    const r = parseDockerLogTimestampLine('plain line')
    expect(r.timestamp).toBeNull()
    expect(r.text).toBe('plain line')
  })

  it('illegal prefix keeps original', () => {
    const r = parseDockerLogTimestampLine('not-a-date rest')
    expect(r.timestamp).toBeNull()
    expect(r.text).toBe('not-a-date rest')
  })
})

describe('DualStreamLogAssembler', () => {
  it('keeps stdout/stderr decoders separate and renumbers sequences', () => {
    const a = new DualStreamLogAssembler()
    const e1 = a.push('stdout', Buffer.from('2024-01-01T00:00:00Z out\n'))
    const e2 = a.push('stderr', Buffer.from('2024-01-01T00:00:01Z err\n'))
    expect(e1[0].stream).toBe('stdout')
    expect(e1[0].text).toBe('out')
    expect(e2[0].stream).toBe('stderr')
    expect(e2[0].sequence).toBe(e1[0].sequence + 1)
  })

  it('assembles one line across frames and flushes partial at EOF', () => {
    const a = new DualStreamLogAssembler()
    expect(a.push('stdout', Buffer.from('hel'))).toEqual([])
    const mid = a.push('stdout', Buffer.from('lo\nwor'))
    expect(mid).toHaveLength(1)
    expect(mid[0].text).toBe('hello')
    const rest = a.flush()
    expect(rest).toHaveLength(1)
    expect(rest[0].text).toBe('wor')
  })

  it('utf-8 chinese/emoji across chunks does not corrupt', () => {
    const a = new DualStreamLogAssembler()
    const text = '中文🎉'
    const buf = Buffer.from(text + '\n', 'utf8')
    const left = buf.subarray(0, 4)
    const right = buf.subarray(4)
    expect(a.push('stdout', left)).toEqual([])
    const lines = a.push('stdout', right)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe(text)
  })

  it('strips ansi in line text', () => {
    const a = new DualStreamLogAssembler()
    const lines = a.push('stdout', Buffer.from('\u001b[32mgreen\u001b[0m\n'))
    expect(lines[0].text).toBe('green')
  })
})
