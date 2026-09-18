import { describe, expect, it } from 'vitest'
import {
  assessAiToolCall, formatAiRiskReclassifyContent, omitDeclaredRiskArg,
  sanitizeAiToolPermission, AI_TOOL_EXPLANATION_MAX_CHARS,
} from './aiToolPolicy'

const explanation = '检查磁盘占用，仅读取信息，不修改文件或服务。'

describe('declared AI permission policy', () => {
  it.each(['docker system df -v', 'last -n 5 reboot', 'custom-inspect --json'])('honors the read declaration for %s without keyword classification', command => {
    expect(assessAiToolCall('exec', { command, risk: 'read', explanation }, 'ask')).toEqual({ action: 'allow', risk: 'read', reason: explanation })
  })

  it.each(['read', 'write', 'privileged'] as const)('applies each mode to a %s declaration', risk => {
    const args = { command: 'df -h', risk, explanation }
    expect(assessAiToolCall('exec', args, 'ask').action).toBe(risk === 'read' ? 'allow' : 'ask')
    expect(assessAiToolCall('exec', args, 'readonly').action).toBe(risk === 'read' ? 'allow' : 'deny')
    expect(assessAiToolCall('exec', args, 'auto').action).toBe('allow')
  })

  it('does not impose a separate high-risk command gate', () => {
    const args = { command: 'reboot', risk: 'write', explanation: '重启服务器，会中断当前连接和运行中的服务。' }
    expect(assessAiToolCall('exec', args, 'ask').action).toBe('ask')
    expect(assessAiToolCall('exec', args, 'auto').action).toBe('allow')
  })

  it.each(['exec', 'service_control', 'pty_write', 'read_file', 'write_file', 'edit_file', 'grep', 'get_job'])('requires declaration metadata for %s', tool => {
    expect(assessAiToolCall(tool, {}, 'auto')).toMatchObject({ action: 'reclassify', code: 'RISK_REQUIRED' })
    expect(assessAiToolCall(tool, { risk: 'read' }, 'auto')).toMatchObject({ action: 'reclassify', code: 'EXPLANATION_REQUIRED' })
    expect(assessAiToolCall(tool, { risk: 'read', explanation }, 'ask').action).toBe('allow')
  })

  it.each(['', 'READ', 'destructive', 'forbidden', null, 1])('rejects invalid risk %s', risk => {
    expect(assessAiToolCall('exec', { risk, explanation }, 'auto')).toMatchObject({ action: 'reclassify', code: 'RISK_REQUIRED' })
  })

  it.each([undefined, null, '', '  ', {}, 123, 'x'.repeat(AI_TOOL_EXPLANATION_MAX_CHARS + 1)])('rejects missing or malformed explanations', explanation => {
    expect(assessAiToolCall('exec', { risk: 'read', explanation }, 'auto')).toMatchObject({ action: 'reclassify', code: 'EXPLANATION_REQUIRED' })
  })

  it('retains the explanation as plain text and strips metadata from execution args', () => {
    const args = { command: 'df -h', risk: 'read', explanation: '  <说明>仅查询</说明>  ', sessionId: 's' }
    expect(assessAiToolCall('exec', args).reason).toBe('<说明>仅查询</说明>')
    expect(omitDeclaredRiskArg(args)).toEqual({ command: 'df -h', sessionId: 's' })
    expect(args.explanation).toBe('  <说明>仅查询</说明>  ')
  })

  it('requests valid JSON fields without inventing a host risk level', () => {
    const gate = assessAiToolCall('exec', { risk: 'read' })
    if (gate.action !== 'reclassify') throw new Error('expected invalid request')
    const content = formatAiRiskReclassifyContent(gate)
    expect(content).toContain('EXPLANATION_REQUIRED')
    expect(content).toContain('explanation')
    expect(content).not.toContain('主机判定')
    expect(content).not.toContain('RISK_UNDERSTATED')
  })

  it('keeps permission mode migration', () => {
    expect(sanitizeAiToolPermission('ask-write')).toBe('ask')
    expect(sanitizeAiToolPermission('invalid')).toBe('ask')
    expect(sanitizeAiToolPermission('auto')).toBe('auto')
  })
})
