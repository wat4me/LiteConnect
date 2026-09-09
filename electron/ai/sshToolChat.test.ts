import { describe, expect, it } from 'vitest'
import {
  accumulateToolCallDeltas,
  bindSessionArgs,
  looksLikeToolsUnsupported,
  parseToolCallArguments,
  sanitizeTrackedCwd,
  sshToolsForChat,
  sshToolSystemAddendum,
} from './sshToolChat'

describe('sshToolChat helpers', () => {
  it('always pins sidebar tool calls to the bound session', () => {
    expect(bindSessionArgs({ command: 'df -h' }, 'sid-1')).toEqual({ command: 'df -h', sessionId: 'sid-1' })
    expect(bindSessionArgs({ sessionId: 'keep', command: 'ls' }, 'sid-1')).toEqual({
      sessionId: 'sid-1',
      command: 'ls',
    })
    expect(bindSessionArgs({ sessionIds: ['other'], command: 'uptime' }, 'sid-1')).toEqual({
      sessionId: 'sid-1',
      command: 'uptime',
    })
  })

  it('accumulates streamed tool call fragments', () => {
    const acc = new Map()
    accumulateToolCallDeltas(acc, [{ index: 0, id: 'c1', function: { name: 'ex' } }])
    accumulateToolCallDeltas(acc, [{ index: 0, function: { name: 'ec', arguments: '{"c' } }])
    accumulateToolCallDeltas(acc, [{ index: 0, function: { arguments: 'md":"df"}' } }])
    expect(acc.get(0)).toEqual({ id: 'c1', name: 'exec', arguments: '{"cmd":"df"}' })
  })

  it('parses tool arguments and flags unsupported-tools errors', () => {
    expect(parseToolCallArguments('{"command":"ls"}')).toEqual({ command: 'ls' })
    expect(parseToolCallArguments('')).toEqual({})
    expect(looksLikeToolsUnsupported('tools is not supported by this model')).toBe(true)
    expect(looksLikeToolsUnsupported('rate limit')).toBe(false)
  })

  it('does not tell the sidebar model to pass sessionId or pick a host', () => {
    const text = sshToolSystemAddendum({
      sessionId: 'abc',
      connectionName: 'web-1',
      username: 'deploy',
      host: '10.0.0.8',
    })
    expect(text).not.toContain('sessionId=')
    expect(text).not.toContain('list_connections')
    expect(text).not.toContain('connect(')
    expect(text).toContain('不要传 sessionId')
    expect(text).toContain('grep')
    expect(text).toContain('read_file(startLine, limit)')
    expect(text).toContain('risk')
    expect(text).toContain('read（只读）')
    expect(text).toContain('write（修改）')
    expect(text).toContain('privileged（提权）')
    expect(text).not.toMatch(/\b(df|ps|rm|sudo|mkfs)\b/)
    expect(text).not.toContain('当前工作目录')
  })

  it('appends a tracked cwd at the end of the addendum', () => {
    const text = sshToolSystemAddendum({
      sessionId: 'abc',
      cwd: '/var/www/app',
    })
    expect(text.endsWith('当前工作目录: /var/www/app。未写绝对路径时默认相对此目录。')).toBe(true)
    expect(sanitizeTrackedCwd('  /tmp  ')).toBe('/tmp')
    expect(sanitizeTrackedCwd('a\nb')).toBe('')
  })

  it('requires a declared risk on exec but not on inventory tools', () => {
    const tools = sshToolsForChat()
    const exec = tools.find((t) => t.function.name === 'exec')
    expect(exec?.function.parameters.required).toEqual(expect.arrayContaining(['command', 'risk']))
    expect((exec?.function.parameters.properties as { risk?: { enum?: string[] } }).risk?.enum).toEqual([
      'read',
      'write',
      'privileged',
    ])
    expect(exec?.function.parameters.required).not.toEqual(expect.arrayContaining(['sessionId']))
    expect(exec?.function.parameters.properties).not.toHaveProperty('sessionId')
    expect(exec?.function.parameters.properties).not.toHaveProperty('group')
    expect(exec?.function.description).not.toMatch(/list_sessions|connect/)
  })

  it('hides session-switching tools from the sidebar', () => {
    const names = sshToolsForChat().map((t) => t.function.name)
    expect(names).not.toContain('list_sessions')
    expect(names).not.toContain('list_connections')
    expect(names).not.toContain('list_groups')
    expect(names).not.toContain('connect')
    expect(names).not.toContain('save_connection')
    expect(names).not.toContain('disconnect')
    expect(names).toContain('exec')
    expect(names).toContain('read_file')
    expect(names).toContain('grep')
  })
})
