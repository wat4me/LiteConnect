import { afterEach, expect, it, vi } from 'vitest'
import { resolveToolApproval, runAiChatStream } from './chatStream'
import type { SshMcpRuntime } from '../mcp/runtime'
import type { AiChatStreamPayload } from '../../shared/types/ai'

const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const settings = {
  baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test',
  systemPrompt: '', temperature: 0, maxToolRounds: 2,
}
const sse = (delta: object) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`,
)

afterEach(() => vi.unstubAllGlobals())

it.each(['write_file', 'edit_file'])('announces remote preview preparation before asking to approve %s', async name => {
  const requestId = `prepare-${name}`
  const args = {
    sessionId, path: '/tmp/config', risk: 'write', explanation: '更新配置',
    ...(name === 'write_file' ? { content: 'new\n' } : { oldString: 'old', newString: 'new' }),
  }
  const fetcher = vi.fn()
    .mockResolvedValueOnce(sse({ tool_calls: [{
      index: 0, id: 'edit', function: { name, arguments: JSON.stringify(args) },
    }] }))
    .mockResolvedValueOnce(sse({ content: 'finished' }))
  vi.stubGlobal('fetch', fetcher)

  let releaseRead!: (result: object) => void
  const deferredRead = new Promise<object>(resolve => { releaseRead = resolve })
  let announceRead!: () => void
  const readStarted = new Promise<void>(resolve => { announceRead = resolve })
  const call = vi.fn().mockImplementation((tool: string) => {
    if (tool === 'read_file') {
      announceRead()
      return deferredRead
    }
    return Promise.resolve({ isError: false, content: '', structuredContent: { sessions: [] } })
  })
  const events: AiChatStreamPayload[] = []
  const approvalRequested = vi.fn(() => {
    expect(events.at(-1)).toMatchObject({ type: 'tool', value: { phase: 'ask', id: 'edit' } })
    // The approval API is available only after the preview has completed.
    expect(resolveToolApproval(requestId, 'edit', false)).toBe(true)
  })
  const reply = runAiChatStream({
    settings, requestId, sessionId,
    messages: [{ role: 'user', content: 'update configuration' }],
    sshMcpRuntime: { call } as unknown as SshMcpRuntime,
    emit: event => events.push(event),
    onToolApprovalRequested: approvalRequested,
  })

  await readStarted
  expect(events.at(-1)).toEqual({ type: 'model-status', value: 'tool-prepare' })
  expect(events.some(event => event.type === 'tool')).toBe(false)
  expect(approvalRequested).not.toHaveBeenCalled()
  expect(resolveToolApproval(requestId, 'edit', true)).toBe(false)

  releaseRead({ isError: false, content: 'old\n', structuredContent: { content: 'old\n', eof: true } })
  const result = await reply
  expect(approvalRequested).toHaveBeenCalledOnce()
  expect(result.toolRuns?.[0].status).toBe('denied')
  expect(result.content).toBe('finished')
  expect(call.mock.calls.map(([tool]) => tool)).toEqual(['list_sessions', 'read_file'])
  expect(fetcher).toHaveBeenCalledTimes(2)
})
