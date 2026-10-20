import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatStream } from './chatStream'
import { resolveToolApproval } from '../tools/streamControl'
import type { AiChatStreamPayload, AiResolvedConfig } from '../../../shared/types/ai'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { aiToolSchemaTokens } from '../../../shared/aiContextPressure'
import { workspaceToolsForChat } from '../../../shared/aiWorkspacePrompt'

const sessionId = 'ea6f5590-2dfc-404e-8af6-fc65dd9c28c7'
const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'ask' }
const targets = [{ connectionId: 'server-a', sessionId, name: 'A', host: 'a.test', port: 22, username: 'ops' }]
let nextCallId = 0
const sse = (calls: { name: string; args: object }[]) => new Response(`data: ${JSON.stringify({ choices: [{ delta: calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: `call-${nextCallId++}`, function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: 'done' } }] })}\n\ndata: [DONE]\n\n`)
const load = (groups = ['file_transfer']) => ({ name: 'load_tools', args: { groups } })
const upload = { name: 'upload_file', args: { connectionId: 'server-a', localPath: 'C:/logs/a.log', remotePath: '/tmp/a.log', risk: 'write', explanation: '上传日志到所选服务器' } }
const makeRuntime = () => ({ hasSession: vi.fn(() => true), call: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ isError: false, content: '{}', structuredContent: { sessions: [] } })) })
afterEach(() => vi.unstubAllGlobals())

it.each([false, true])('loads locally, defers a preplanned upload and still requires actual write approval (workspace=%s)', async workspace => {
  const ssh = makeRuntime()
  const fetcher = vi.fn().mockResolvedValueOnce(sse([load(), upload])).mockResolvedValueOnce(sse([upload])).mockResolvedValueOnce(sse([]))
  vi.stubGlobal('fetch', fetcher)
  const events: AiChatStreamPayload[] = []
  const approval = vi.fn((input: { requestId: string; callId: string; sessionId: string }) => {
    expect(ssh.call.mock.calls.filter(([name]) => name === 'upload_file')).toHaveLength(0)
    expect(input.sessionId).toBe(sessionId)
    expect(resolveToolApproval(input.requestId, input.callId, true)).toBe(true)
  })
  const reply = await runAiChatStream({ settings, sessionId, workspaceTargets: workspace ? targets : undefined,
    messages: [{ role: 'user', content: '上传日志' }], requestId: `load-upload-${workspace}`, emit: event => events.push(event),
    sshMcpRuntime: ssh as unknown as SshMcpRuntime, onToolApprovalRequested: approval,
  })
  expect(approval).toHaveBeenCalledOnce()
  expect(ssh.call.mock.calls.filter(([name]) => name === 'load_tools')).toHaveLength(0)
  expect(ssh.call).toHaveBeenCalledWith('upload_file', expect.objectContaining({ sessionId, remotePath: '/tmp/a.log' }), expect.anything())
  const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))
  expect(bodies[0].tools.some((tool: { function: { name: string } }) => tool.function.name === 'upload_file')).toBe(false)
  expect(bodies[1].tools.some((tool: { function: { name: string } }) => tool.function.name === 'upload_file')).toBe(true)
  expect(bodies[1].tools.some((tool: { function: { name: string } }) => tool.function.name === 'pty_open')).toBe(false)
  expect(reply.toolRuns?.[1].content).toContain('TOOL_LOAD_BATCH_DEFERRED')
  expect(reply.toolRuns?.at(-1)).toMatchObject({ name: 'upload_file', status: 'done', isError: false })
  const pressures = events.filter(event => event.type === 'context-pressure').map(event => event.value.usedTokens)
  expect(pressures[1]).toBeGreaterThan(pressures[0])
  expect(reply.apiMessages?.filter(message => message.role === 'tool')).toHaveLength(3)
})

it('blocks invented optional and removed tools without executing or silently auto-loading them', async () => {
  const ssh = makeRuntime()
  const fetcher = vi.fn().mockResolvedValueOnce(sse([upload, { name: 'service_control', args: { unit: 'nginx', action: 'restart', risk: 'write', explanation: '重启服务' } }])).mockResolvedValueOnce(sse([]))
  vi.stubGlobal('fetch', fetcher)
  const reply = await runAiChatStream({ settings, workspaceTargets: targets, messages: [{ role: 'user', content: '检查' }], requestId: 'unloaded-tools', emit: () => {}, sshMcpRuntime: ssh as unknown as SshMcpRuntime })
  expect(ssh.call).not.toHaveBeenCalled()
  expect(reply.toolRuns).toHaveLength(2)
  expect(reply.toolRuns?.every(run => run.status === 'blocked' && run.content.includes('TOOL_NOT_AVAILABLE'))).toBe(true)
})

it('loads no partial group on invalid input and preserves unattended read-only and no-question rules', async () => {
  const ssh = makeRuntime()
  const fetcher = vi.fn().mockResolvedValueOnce(sse([load(['file_transfer', 'ask_user'])]))
    .mockResolvedValueOnce(sse([load()])).mockResolvedValueOnce(sse([upload])).mockResolvedValueOnce(sse([]))
  vi.stubGlobal('fetch', fetcher)
  const reply = await runAiChatStream({ settings: { ...settings, toolPermission: 'readonly' }, allowQuestions: false,
    workspaceTargets: targets, messages: [{ role: 'user', content: '巡检' }], requestId: 'load-unattended', emit: () => {}, sshMcpRuntime: ssh as unknown as SshMcpRuntime,
  })
  const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body))
  expect(bodies[1].tools.some((tool: { function: { name: string } }) => tool.function.name === 'upload_file')).toBe(false)
  expect(bodies.every(body => !body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'ask_user'))).toBe(true)
  expect(reply.toolRuns?.[0]).toMatchObject({ isError: true, content: expect.stringContaining('INVALID_TOOL_GROUPS') })
  expect(reply.toolRuns?.at(-1)).toMatchObject({ isError: true, status: 'blocked', content: expect.stringContaining('READONLY_MODE') })
  expect(ssh.call).not.toHaveBeenCalled()
})

it('retains loaded groups in a subsequent request even when old tool calls are absent from the projected context', async () => {
  const ssh = makeRuntime()
  const fetcher = vi.fn().mockResolvedValueOnce(sse([]))
  vi.stubGlobal('fetch', fetcher)
  const reply = await runAiChatStream({ settings, toolGroups: ['interactive_terminal'], workspaceTargets: targets,
    messages: [{ role: 'user', content: '继续' }], requestId: 'remember-loaded', emit: () => {}, sshMcpRuntime: ssh as unknown as SshMcpRuntime,
  })
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'pty_open')).toBe(true)
  expect(body.tools.some((tool: { function: { name: string } }) => tool.function.name === 'upload_file')).toBe(false)
  expect(reply.contextPressure!.usedTokens).toBeGreaterThan(aiToolSchemaTokens(workspaceToolsForChat(['interactive_terminal'])))
})
