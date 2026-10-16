import { afterEach, expect, it, vi } from 'vitest'
import type { AiSessionStore } from '../../../shared/types/ai'
import type { SshMcpJobResult } from '../../../shared/mcp/types'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { AiExecutionService } from './executionService'
import { flattenConversationForApi } from '../../../shared/aiMessages'

const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const services: AiExecutionService[] = []
afterEach(() => { services.forEach(service => service.dispose()); services.length = 0; vi.unstubAllGlobals() })
const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)

it.each([
  { fast: false, duringReply: false, checkpoint: false }, { fast: true, duringReply: false, checkpoint: false },
  { fast: false, duringReply: false, checkpoint: true }, { fast: true, duringReply: false, checkpoint: true },
  { fast: false, duringReply: true, checkpoint: false }, { fast: false, duringReply: true, checkpoint: true },
])('sends completed job output to the real model request ($fast fast, $duringReply during reply, $checkpoint checkpoint)', async ({ fast, duringReply, checkpoint }) => {
  const store: AiSessionStore = {
    version: 1, activeThreadId: 'thread', defaultContextFiles: [],
    threads: [{ id: 'thread', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [
      { id: 'old-user', role: 'user', content: 'Check server logs.', createdAt: 1 },
      { id: 'old-assistant', role: 'assistant', content: 'I will inspect the log distribution.', status: 'completed', createdAt: 2 },
      { id: 'user', role: 'user', content: 'Count the log sources.', createdAt: 3 },
    ], ...(checkpoint ? { contextCheckpoint: { version: 1 as const, throughMessageId: 'old-assistant', summary: 'User wants log source counts.', createdAt: 2, sourceTokens: 40, summaryTokens: 10, model: 'test' } } : {}) }],
  }
  const job: SshMcpJobResult = { jobId: 'log-count-job', sessionId, command: 'wc -l /var/log/messages', status: 'running', startedAt: 4 }
  let settled: (job: SshMcpJobResult) => void = () => {}
  const finish = () => { Object.assign(job, { status: 'completed', exitCode: 0, stdout: 'journal: 19704363\navahi-daemon: 372530' }); settled({ ...job }) }
  const call = vi.fn(async (name: string) => {
    if (name === 'list_sessions') return { isError: false, content: '{}', structuredContent: { sessions: [] } }
    expect(name).toBe('exec')
    // The completion event can precede background ownership registration.
    if (fast) finish()
    const ack = { jobId: job.jobId, status: 'running' }
    return { isError: false, content: JSON.stringify(ack), structuredContent: ack }
  })
  const fetcher = vi.fn()
    .mockResolvedValueOnce(sse({ tool_calls: [{ index: 0, id: 'launch', function: { name: 'exec', arguments: JSON.stringify({ command: job.command, background: true, risk: 'read', explanation: 'Count log sources.' }) } }] }))
    .mockImplementationOnce(async () => {
      if (fast) expect(store.threads[0].messages.at(-1)?.apiMessages?.at(-1)?.content).toContain('19704363')
      if (duringReply) finish()
      return sse({ content: fast ? 'Log source counts received.' : 'Waiting for log-count-job.' })
    })
    .mockImplementationOnce(async () => {
      if (duringReply) expect(store.threads[0].messages.at(-1)?.apiMessages?.at(-1)?.content).toContain('19704363')
      return sse({ content: 'Log source counts received.' })
    })
  vi.stubGlobal('fetch', fetcher)
  const service = new AiExecutionService({
    settings: { ready: async () => {}, config: () => ({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'readonly' }), limits: () => ({}) },
    history: {
      read: async () => structuredClone(store), hydrate: vi.fn(), checkpoint: vi.fn(),
      save: async (_id, record) => {
        const records = store.threads[0].messages
        const index = records.findIndex(item => item.id === record.id)
        if (index < 0) records.push(structuredClone(record))
        else records[index] = structuredClone(record)
      },
    },
    runtime: { call, hasSession: () => true, getJobResult: () => ({ ...job }), onJobSettled: (callback: typeof settled) => { settled = callback; return () => {} } } as unknown as SshMcpRuntime,
  })
  services.push(service)
  await service.run({ requestId: 'launch-logs', historyId: 'host', owner: { id: 1, kind: 'interactive' }, target: { sessionId, threadId: 'thread', assistantMessageId: 'launch-reply', createdAt: 4 } })
  if (!fast && !duringReply) finish()
  await vi.waitFor(() => expect(store.threads[0].messages.at(-1)?.content).toContain('Log source counts received.'))
  expect(fetcher).toHaveBeenCalledTimes(fast ? 2 : 3)
  const messages = JSON.parse(fetcher.mock.calls[fast ? 1 : 2][1].body).messages as Array<{ role: string; content: string | null }>
  expect(messages.at(-1)?.role).toBe('user')
  expect(messages.at(-1)?.content).toContain('"jobId":"log-count-job"')
  expect(messages.at(-1)?.content).toContain('"status":"completed"')
  expect(messages.at(-1)?.content).toContain('19704363')
  expect(messages.filter(message => message.content?.includes('Application background-task completion'))).toHaveLength(1)
  expect(call.mock.calls.filter(([name]) => name === 'exec')).toHaveLength(1)
  expect(call.mock.calls.some(([name]) => name === 'get_job')).toBe(false)
  const replies = store.threads[0].messages.filter(message => message.role === 'assistant' && message.id !== 'old-assistant')
  expect(replies).toHaveLength(fast || duringReply ? 1 : 2)
  if (fast || duringReply) {
    const transcript = replies[0].apiMessages!
    expect(transcript.map(message => message.role)).toEqual(duringReply ? ['assistant', 'tool', 'assistant', 'user', 'assistant'] : ['assistant', 'tool', 'user', 'assistant'])
    expect(transcript[duringReply ? 3 : 2].content).toContain('19704363')
  }
  expect(flattenConversationForApi(store.threads[0].messages).filter(message => message.content?.includes('Application background-task completion'))).toHaveLength(1)
})
