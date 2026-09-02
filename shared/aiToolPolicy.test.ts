import { describe, expect, it } from 'vitest'
import { assessAiToolCall, sanitizeAiToolPermission } from './aiToolPolicy'

describe('assessAiToolCall', () => {
  it('auto-allows inventory tools even in ask mode', () => {
    const gate = assessAiToolCall('list_sessions', {}, 'ask')
    expect(gate).toEqual({ action: 'allow', risk: 'read', reason: 'list_sessions' })
  })

  it('asks before remote exec in ask mode, including read-only commands', () => {
    const gate = assessAiToolCall('exec', { command: 'ps -ef' }, 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.risk).toBe('read')
  })

  it('auto-runs read-only exec in ask-write mode, but asks for rm', () => {
    expect(assessAiToolCall('exec', { command: 'df -h' }, 'ask-write').action).toBe('allow')
    const rm = assessAiToolCall('exec', { command: 'rm -rf /tmp/x' }, 'ask-write')
    expect(rm.action).toBe('ask')
    expect(rm.risk).toBe('destructive')
  })

  it('never allows deleting /', () => {
    for (const mode of ['ask', 'ask-write', 'readonly', 'auto'] as const) {
      const gate = assessAiToolCall('exec', { command: 'rm -rf /' }, mode)
      expect(gate.action).toBe('deny')
      if (gate.action === 'deny') expect(gate.code).toBe('FORBIDDEN')
    }
  })

  it('readonly mode blocks writes and destructive exec', () => {
    expect(assessAiToolCall('write_file', { path: '/tmp/a', content: 'x' }, 'readonly').action).toBe('deny')
    expect(assessAiToolCall('exec', { command: 'rm -rf /tmp/x' }, 'readonly').action).toBe('deny')
    expect(assessAiToolCall('exec', { command: 'uptime' }, 'readonly').action).toBe('allow')
  })

  it('auto still blocks forbidden, allows destructive', () => {
    expect(assessAiToolCall('exec', { command: 'rm -rf /tmp/x' }, 'auto').action).toBe('allow')
    expect(assessAiToolCall('exec', { command: 'rm -rf /' }, 'auto').action).toBe('deny')
  })

  it('treats pty_open as destructive that must be confirmed in ask mode', () => {
    const gate = assessAiToolCall('pty_open', { sessionId: 'x' }, 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.risk).toBe('destructive')
  })

  it('sanitizes unknown permission values to ask', () => {
    expect(sanitizeAiToolPermission('nope')).toBe('ask')
    expect(sanitizeAiToolPermission('readonly')).toBe('readonly')
  })
})
