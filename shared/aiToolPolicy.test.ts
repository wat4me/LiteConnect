import { describe, expect, it } from 'vitest'
import {
  assessAiToolCall,
  formatAiRiskReclassifyContent,
  omitDeclaredRiskArg,
  sanitizeAiToolPermission,
  toDeclaredRisk,
} from './aiToolPolicy'

describe('assessAiToolCall', () => {
  it('auto-allows grep and glob as read tools', () => {
    expect(assessAiToolCall('grep', { path: '/var/log', pattern: 'error' }, 'ask').action).toBe('allow')
    expect(assessAiToolCall('glob', { path: '/etc', pattern: '*.conf' }, 'ask').action).toBe('allow')
  })

  it('auto-allows inventory tools even in ask mode', () => {
    const gate = assessAiToolCall('list_sessions', {}, 'ask')
    expect(gate).toEqual({ action: 'allow', risk: 'read', reason: 'list_sessions' })
  })

  it('auto-runs read-only exec in ask mode, but asks for writes', () => {
    const gate = assessAiToolCall('exec', { command: 'ps -ef', risk: 'read' }, 'ask')
    expect(gate.action).toBe('allow')
    expect(gate.risk).toBe('read')
    const rm = assessAiToolCall('exec', { command: 'rm -rf /tmp/x', risk: 'write' }, 'ask')
    expect(rm.action).toBe('ask')
    expect(rm.risk).toBe('destructive')
  })

  it('asks for high-risk commands instead of hard-blocking them', () => {
    for (const mode of ['ask', 'auto'] as const) {
      const rm = assessAiToolCall('exec', { command: 'rm -rf /', risk: 'privileged' }, mode)
      expect(rm.action).toBe('ask')
      expect(rm.risk).toBe('forbidden')
      const power = assessAiToolCall('exec', { command: 'uptime; who; last -n 5 reboot', risk: 'read' }, mode)
      expect(power.action).toBe('ask')
      expect(power.risk).toBe('forbidden')
    }
    const readonly = assessAiToolCall('exec', { command: 'rm -rf /', risk: 'privileged' }, 'readonly')
    expect(readonly.action).toBe('deny')
    if (readonly.action === 'deny') expect(readonly.code).toBe('READONLY_MODE')
  })

  it('treats save_connection as a write that asks in ask mode', () => {
    const gate = assessAiToolCall(
      'save_connection',
      { host: '10.0.0.8', username: 'root', password: 'x' },
      'ask',
    )
    expect(gate.action).toBe('ask')
    expect(gate.risk).toBe('write')
  })

  it('readonly mode blocks writes and destructive exec', () => {
    expect(assessAiToolCall('write_file', { path: '/tmp/a', content: 'x' }, 'readonly').action).toBe('deny')
    expect(assessAiToolCall('save_connection', { host: '10.0.0.8', username: 'root', password: 'x' }, 'readonly').action).toBe('deny')
    expect(assessAiToolCall('exec', { command: 'rm -rf /tmp/x', risk: 'write' }, 'readonly').action).toBe('deny')
    expect(assessAiToolCall('exec', { command: 'uptime', risk: 'read' }, 'readonly').action).toBe('allow')
  })

  it('auto allows ordinary destructive, but still asks for high-risk', () => {
    expect(assessAiToolCall('exec', { command: 'rm -rf /tmp/x', risk: 'write' }, 'auto').action).toBe('allow')
    expect(assessAiToolCall('exec', { command: 'rm -rf /', risk: 'privileged' }, 'auto').action).toBe('ask')
    expect(assessAiToolCall('exec', { command: 'reboot now', risk: 'write' }, 'auto').action).toBe('ask')
  })

  it('treats pty_open as destructive that must be confirmed in ask mode', () => {
    const gate = assessAiToolCall('pty_open', { sessionId: 'x' }, 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.risk).toBe('destructive')
  })

  it('sanitizes unknown permission values to ask', () => {
    expect(sanitizeAiToolPermission('nope')).toBe('ask')
    expect(sanitizeAiToolPermission('ask-write')).toBe('ask')
    expect(sanitizeAiToolPermission('readonly')).toBe('readonly')
  })

  it('rejects exec when the model omits risk, so it can retry with a declaration', () => {
    const gate = assessAiToolCall('exec', { command: 'df -h' }, 'ask')
    expect(gate.action).toBe('reclassify')
    if (gate.action === 'reclassify') {
      expect(gate.code).toBe('RISK_REQUIRED')
      expect(gate.expected).toBe('read')
    }
  })

  it('rejects when the model understates write as read', () => {
    const gate = assessAiToolCall('exec', { command: 'rm -rf /tmp/x', risk: 'read' }, 'ask')
    expect(gate.action).toBe('reclassify')
    if (gate.action === 'reclassify') {
      expect(gate.code).toBe('RISK_UNDERSTATED')
      expect(gate.declared).toBe('read')
      expect(gate.expected).toBe('write')
      expect(gate.risk).toBe('destructive')
    }
  })

  it('rejects when the model understates privileged as write', () => {
    const gate = assessAiToolCall('exec', { command: 'sudo systemctl restart nginx', risk: 'write' }, 'auto')
    expect(gate.action).toBe('reclassify')
    if (gate.action === 'reclassify') {
      expect(gate.code).toBe('RISK_UNDERSTATED')
      expect(gate.expected).toBe('privileged')
    }
  })

  it('allows an overstated declaration (privileged for a write)', () => {
    const gate = assessAiToolCall('exec', { command: 'rm -rf /tmp/x', risk: 'privileged' }, 'auto')
    expect(gate.action).toBe('allow')
    expect(gate.risk).toBe('destructive')
  })

  it('still rejects an empty command', () => {
    const gate = assessAiToolCall('exec', { command: '   ', risk: 'write' }, 'ask')
    expect(gate.action).toBe('deny')
    if (gate.action === 'deny') expect(gate.code).toBe('FORBIDDEN')
  })

  it('treats mkdir as write, not read', () => {
    const gate = assessAiToolCall('exec', { command: 'mkdir /tmp/a', risk: 'write' }, 'ask')
    expect(gate.action).toBe('ask')
    expect(gate.risk).toBe('write')
  })
})

describe('declared-risk helpers', () => {
  it('maps host risks onto the three-level scale', () => {
    expect(toDeclaredRisk('read')).toBe('read')
    expect(toDeclaredRisk('write')).toBe('write')
    expect(toDeclaredRisk('destructive')).toBe('write')
    expect(toDeclaredRisk('privileged')).toBe('privileged')
    expect(toDeclaredRisk('forbidden')).toBe('write')
  })

  it('strips risk before MCP execution', () => {
    expect(omitDeclaredRiskArg({ command: 'df -h', risk: 'read', sessionId: 's' })).toEqual({
      command: 'df -h',
      sessionId: 's',
    })
  })

  it('tells the model which risk to retry with', () => {
    const text = formatAiRiskReclassifyContent({
      action: 'reclassify',
      risk: 'destructive',
      code: 'RISK_UNDERSTATED',
      reason: 'declared read, host write',
      declared: 'read',
      expected: 'write',
    })
    expect(text).toContain('RISK_UNDERSTATED')
    expect(text).toContain('risk 设为 "write"')
    expect(text).toContain('不要改用更低的 risk 绕过')
    expect(text).toContain('read（只读）')
    expect(text).not.toMatch(/\b(df|ps|rm|sudo|mkfs)\b/)
  })
})
