import { describe, expect, it } from 'vitest'
import { AI_TOOL_TRUNCATION_NOTICE, clampTextWindow, clampToolResultForModel } from './toolResultClamp'

describe('clampTextWindow', () => {
  it('keeps short text', () => {
    expect(clampTextWindow('hello', 100, 10)).toEqual({ text: 'hello', truncated: false })
  })

  it('cuts by line count then by chars', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `L${i}`).join('\n')
    expect(clampTextWindow(lines, 10_000, 3).text.split('\n')).toEqual(['L0', 'L1', 'L2'])
    expect(clampTextWindow('abcdefghij', 4, 50).text).toBe('abcd')
  })
})

describe('clampToolResultForModel', () => {
  it('leaves a small exec result alone', () => {
    const structured = { stdout: 'ok', stderr: '', exitCode: 0 }
    const result = clampToolResultForModel({
      isError: false,
      content: JSON.stringify(structured, null, 2),
      structuredContent: structured,
    })
    expect(result.content).toContain('ok')
    expect(result.content).not.toContain('[截断]')
  })

  it('truncates huge stdout and tells the model to page or grep', () => {
    const stdout = Array.from({ length: 400 }, (_, i) => `line-${i} ${'x'.repeat(80)}`).join('\n')
    const structured = { stdout, stderr: '', exitCode: 0, command: 'cat /var/log/app.log' }
    const result = clampToolResultForModel({
      isError: false,
      content: JSON.stringify(structured, null, 2),
      structuredContent: structured,
    })
    expect(result.content).toContain('[截断]')
    expect(result.content).toContain('grep')
    expect(result.content).toContain('read_file')
    expect(result.content).toContain(AI_TOOL_TRUNCATION_NOTICE.slice(0, 8))
    const stored = result.structuredContent as { stdout: string; truncated: boolean; notice: string }
    expect(stored.truncated).toBe(true)
    expect(stored.stdout.split('\n').length).toBeLessThanOrEqual(200)
    expect(stored.stdout.length).toBeLessThan(stdout.length)
  })
})
