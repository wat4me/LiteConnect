import { describe, expect, it } from 'vitest'
import { estimateTokens, packAiMessages } from './aiContext'
import {
  estimateSidebarAiRequest,
  sidebarToolSchemaTokens,
  sshToolsForChat,
  sshToolSystemAddendum,
} from './aiSidebarPrompt'

describe('estimateSidebarAiRequest', () => {
  it('matches a plain pack when the sidebar is not bound to a session', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ]
    const pack = packAiMessages({ systemPrompt: 'sys', messages })
    const estimate = estimateSidebarAiRequest({
      systemPrompt: 'sys',
      messages,
    })
    expect(estimate.promptTokens).toBe(pack.promptTokens)
    expect(estimate.toolSchemaTokens).toBe(0)
    expect(estimate.totalTokens).toBe(pack.promptTokens)
  })

  it('includes the SSH addendum, cwd, and tools schema for a bound session', () => {
    const messages = [{ role: 'user' as const, content: 'df -h' }]
    const withoutTools = packAiMessages({
      systemPrompt: 'sys',
      messages,
    })
    const withAddendum = packAiMessages({
      systemPrompt: ['sys', sshToolSystemAddendum({ sessionId: 'sid', cwd: '/var/www' })]
        .filter((s) => s.trim())
        .join('\n\n'),
      messages,
    })
    const estimate = estimateSidebarAiRequest({
      systemPrompt: 'sys',
      messages,
      sessionId: 'sid',
      cwd: '/var/www',
    })
    expect(estimate.promptTokens).toBe(withAddendum.promptTokens)
    expect(estimate.promptTokens).toBeGreaterThan(withoutTools.promptTokens)
    expect(estimate.toolSchemaTokens).toBe(sidebarToolSchemaTokens())
    expect(estimate.toolSchemaTokens).toBeGreaterThan(2_000)
    expect(estimate.totalTokens).toBe(estimate.promptTokens + estimate.toolSchemaTokens)
    expect(estimate.messages[0]?.content).toContain('当前工作目录: /var/www')
    expect(estimate.messages[0]?.content).toContain('不要传 sessionId')
  })

  it('counts tool_calls / tool results the same way packing does', () => {
    const messages = [
      { role: 'user' as const, content: 'disk' },
      {
        role: 'assistant' as const,
        content: '',
        reasoningContent: 'plan',
        toolCalls: [
          { id: 'c1', type: 'function' as const, function: { name: 'exec', arguments: '{"command":"df"}' } },
        ],
      },
      { role: 'tool' as const, toolCallId: 'c1', content: '/ 12%' },
      { role: 'assistant' as const, content: 'ok' },
    ]
    const estimate = estimateSidebarAiRequest({
      systemPrompt: 'sys',
      messages,
      sessionId: 'sid',
    })
    expect(estimate.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(estimate.promptTokens).toBeGreaterThan(
      estimateTokens('sys') + estimateTokens('disk') + estimateTokens('ok'),
    )
  })
})

describe('sshToolsForChat', () => {
  it('hides session-routing tools from the sidebar catalog counted in the meter', () => {
    const names = sshToolsForChat().map((t) => t.function.name)
    expect(names).not.toContain('list_sessions')
    expect(names).not.toContain('connect')
    expect(names).toContain('exec')
    expect(names).toContain('grep')
  })
})
