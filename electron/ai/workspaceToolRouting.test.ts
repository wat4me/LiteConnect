import { afterEach, expect, it, vi } from 'vitest'
import { routeWorkspaceTool, callWorkspaceTool } from './workspaceToolRouting'
import { workspaceToolSystemAddendum, workspaceToolsForChat } from '../../shared/aiWorkspacePrompt'
import type { AiWorkspaceTarget } from '../../shared/aiWorkspace'
import type { SshMcpRuntime } from '../mcp/runtime'
import { resolveToolApproval, runAiChatStream } from './chatStream'

const targets: AiWorkspaceTarget[] = ['a', 'b'].map(id => ({ connectionId: id, sessionId: `ssh-${id}`, name: `server-${id}`, host: `${id}.example`, port: 22, username: 'ops' }))
function runtime() {
  return {
    hasSession: vi.fn(() => true),
    getJobResult: vi.fn(() => ({ sessionId: 'ssh-b' })),
    getPtySessionId: vi.fn(() => 'ssh-b'),
    call: vi.fn(async () => ({ isError: false, content: 'ok', structuredContent: {} })),
  } as unknown as SshMcpRuntime
}
afterEach(() => vi.unstubAllGlobals())

it('routes only explicitly selected targets and overwrites all model supplied session routing', () => {
  const ssh = runtime()
  const routed = routeWorkspaceTool('exec', { connectionId: 'b', sessionId: 'outside', sessionIds: ['outside'], group: 'all', connectMissing: true, command: 'df -h' }, targets, ssh)
  expect(routed.args).toEqual({ sessionId: 'ssh-b', command: 'df -h' })
  expect(routed.label).toContain('server-b')
  for (const args of [{}, { connectionId: 'c' }, { sessionId: 'ssh-a' }]) expect(() => routeWorkspaceTool('exec', args, targets, ssh)).toThrow('SCOPE_DENIED')
  for (const name of ['connect', 'disconnect', 'list_connections', 'save_connection']) expect(() => routeWorkspaceTool(name, { connectionId: 'a' }, targets, ssh)).toThrow('SCOPE_DENIED')
  vi.mocked(ssh.hasSession).mockReturnValue(false)
  expect(() => routeWorkspaceTool('exec', { connectionId: 'a' }, targets, ssh)).toThrow('SCOPE_UNAVAILABLE')
})

it('checks job and PTY handles against the requested host and scopes global listing results', async () => {
  const ssh = runtime()
  for (const name of ['get_job', 'cancel_job', 'pty_write', 'pty_read', 'pty_resize', 'pty_close']) {
    expect(() => routeWorkspaceTool(name, { connectionId: 'a', jobId: 'job', ptyId: 'pty' }, targets, ssh)).toThrow('SCOPE_DENIED')
    expect(routeWorkspaceTool(name, { connectionId: 'b', jobId: 'job', ptyId: 'pty' }, targets, ssh).args.sessionId).toBe('ssh-b')
  }
  for (const [name, field] of [['list_jobs', 'jobs'], ['pty_list', 'ptys']]) {
    vi.mocked(ssh.call).mockResolvedValueOnce({ isError: false, content: 'unfiltered', structuredContent: { [field]: [{ sessionId: 'ssh-a' }, { sessionId: 'outside' }] } })
    const result = await callWorkspaceTool(ssh, name, { sessionId: 'ssh-a' }, { approvalMode: 'auto', signal: new AbortController().signal })
    expect(result.content).not.toContain('outside')
    expect(result.structuredContent).toEqual({ [field]: [{ sessionId: 'ssh-a' }] })
  }
})

it('exposes a credential-free scope and requires target selection in every tool schema', () => {
  const system = workspaceToolSystemAddendum(targets.map(target => ({ ...target, group: 'Deployment', note: 'nginx frontend', password: 'secret-password', privateKey: 'secret-key' })))
  expect(system).toContain('a.example')
  expect(system).toContain('nginx frontend')
  expect(system).toContain('Deployment')
  expect(system).not.toContain('secret-password')
  expect(system).not.toContain('secret-key')
  expect(system).not.toContain('ssh-a')
  expect(system).not.toContain('不要切换到其它主机')
  for (const tool of workspaceToolsForChat()) {
    expect(tool.function.parameters.required).toContain('connectionId')
    expect(tool.function.parameters.properties).not.toHaveProperty('sessionId')
  }
})

const sse = (delta: object) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
it('keeps target labels through approvals/results and blocks out-of-scope calls before execution', async () => {
  const ssh = runtime()
  const args = { command: 'touch /tmp/scoped', risk: 'write', explanation: 'update marker' }
  const fetcher = vi.fn().mockResolvedValueOnce(sse({ tool_calls: [
    { index: 0, id: 'allowed', function: { name: 'exec', arguments: JSON.stringify({ ...args, connectionId: 'b' }) } },
    { index: 1, id: 'outside', function: { name: 'exec', arguments: JSON.stringify({ ...args, connectionId: 'c' }) } },
  ] })).mockResolvedValueOnce(sse({ content: 'done' }))
  vi.stubGlobal('fetch', fetcher)
  const result = await runAiChatStream({
    requestId: 'workspace-routing', sessionId: 'workspace:test', workspaceTargets: targets,
    messages: [{ role: 'user', content: 'update marker on B' }],
    settings: { baseUrl: 'https://example.test', apiKey: 'test', model: 'test', systemPrompt: '', temperature: 0, toolPermission: 'ask', maxToolRounds: 2 },
    sshMcpRuntime: ssh, emit: () => {},
    onToolApprovalRequested: input => {
      expect(input.sessionId).toBe('ssh-b')
      expect(resolveToolApproval(input.requestId, input.callId, true)).toBe(true)
    },
  })
  expect(ssh.call).toHaveBeenCalledExactlyOnceWith('exec', expect.objectContaining({ sessionId: 'ssh-b' }), expect.anything())
  expect(result.toolRuns?.[0]).toMatchObject({ target: 'server-b (ops@b.example:22)', status: 'done' })
  expect(result.toolRuns?.[1]).toMatchObject({ isError: true, status: 'blocked' })
  expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain('LiteAI')
})
