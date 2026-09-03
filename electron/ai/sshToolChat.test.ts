import { describe, expect, it } from 'vitest'
import {
  accumulateToolCallDeltas,
  bindSessionArgs,
  looksLikeToolsUnsupported,
  parseToolCallArguments,
  sshToolSystemAddendum,
} from './sshToolChat'

describe('sshToolChat helpers', () => {
  it('binds a missing sessionId', () => {
    expect(bindSessionArgs({ command: 'df -h' }, 'sid-1')).toEqual({ command: 'df -h', sessionId: 'sid-1' })
    expect(bindSessionArgs({ sessionId: 'keep', command: 'ls' }, 'sid-1')).toEqual({
      sessionId: 'keep',
      command: 'ls',
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

  it('mentions the bound session in the system addendum', () => {
    const text = sshToolSystemAddendum({
      sessionId: 'abc',
      connectionName: 'web-1',
      username: 'deploy',
      host: '10.0.0.8',
    })
    expect(text).toContain('abc')
    expect(text).toContain('deploy@10.0.0.8')
    expect(text).toContain('connect(connectionId)')
    expect(text).toContain('save_connection')
  })
})
