import { beforeEach, expect, it, vi } from 'vitest'
import { createScheduleExecutor } from './aiScheduleExecutor'
import type { AiSchedule } from '../../shared/aiSchedules'

const mocks = vi.hoisted(() => ({ write: vi.fn(async (_id?: string, _store?: unknown) => {}), remove: vi.fn() }))
vi.mock('../ai/historyStore', () => ({ writeAiSessionStore: mocks.write }))
vi.mock('../store/appDatabase', () => ({ aiSessionKey: (id: string) => `ai-session:${id}`, getAppDatabase: () => ({ deleteSingleton: mocks.remove }) }))
beforeEach(() => vi.clearAllMocks())
const plan: AiSchedule = { id: 'plan', name: '巡检', connectionId: 'host', prompt: 'inspect', intervalMinutes: 60, enabled: true, nextRunAt: 1, createdAt: 1, updatedAt: 1 }
function setup() {
  const signal = new AbortController()
  const service = { run: vi.fn(async (_request: any) => ({ content: 'healthy', toolRuns: [] })), disposeOwner: vi.fn() }
  const ssh = { connect: vi.fn(async (_connection: any, _callbacks?: any) => 'dedicated'), disconnect: vi.fn(), getPendingHostKey: vi.fn(() => undefined as any), rejectHostKey: vi.fn() }
  const credentials = { init: vi.fn(async () => {}), getConnectionForAuth: vi.fn((_id: string) => ({ id: 'host' })) }
  return { signal, service, ssh, credentials, execute: createScheduleExecutor(service as any, ssh as any, credentials as any) }
}
it('uses an isolated read-only automation identity and foreground-only execution, then releases transport and temporary history', async () => {
  const { execute, service, ssh, signal } = setup()
  expect(await execute(plan, 'run', signal.signal)).toMatchObject({ content: 'healthy' })
  expect(service.run).toHaveBeenCalledWith(expect.objectContaining({ owner: expect.objectContaining({ id: 'schedule:run', kind: 'automation' }), foregroundOnly: true, historyId: 'schedule:run', target: expect.objectContaining({ sessionId: 'dedicated' }) }))
  expect(ssh.disconnect).toHaveBeenCalledWith('dedicated')
  expect(mocks.remove).toHaveBeenCalledWith('ai-session:schedule:run')
})

it('passes the plan-resolved model config into automation execution', async () => {
  const { signal, service, ssh, credentials } = setup()
  const config = vi.fn(() => ({ baseUrl: 'https://example.test', apiKey: 'k', model: 'plan-model', systemPrompt: '', temperature: 0 }))
  const execute = createScheduleExecutor(service as any, ssh as any, credentials as any, config as any)
  await execute({ ...plan, providerId: 'p', model: 'plan-model' }, 'run', signal.signal)
  expect(config).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p', model: 'plan-model' }))
  expect(service.run).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ model: 'plan-model' }) }))
})
it('does not take over pending interactive host verification', async () => {
  const { execute, ssh, signal } = setup()
  ssh.getPendingHostKey.mockReturnValue({ callbacks: {} })
  expect(await execute(plan, 'run', signal.signal)).toMatchObject({ hosts: [{ status: 'failed', error: expect.stringContaining('等待主机验证') }] })
  expect(ssh.connect).not.toHaveBeenCalled()
  expect(ssh.rejectHostKey).not.toHaveBeenCalled()
})

it('bounds long tool output while preserving valid JSON and nonzero exit status', async () => {
  const { execute, service, signal } = setup()
  service.run.mockResolvedValueOnce({ content: 'report', toolRuns: [{ id: 't', name: 'exec', args: '{}', content: JSON.stringify({ exitCode: 2, stdout: 'output '.repeat(2000), stderr: 'error' }), status: 'done', isError: false }] } as any)
  const result = await execute(plan, 'run', signal.signal)
  const stored = JSON.parse(result.toolRuns![0].content)
  expect(stored.exitCode).toBe(2)
  expect(stored.stdout.length).toBeLessThanOrEqual(3000)
  expect(stored.truncated).toBe(true)
})
it('rejects its own unknown host key without leaving a modal or stealing another request', async () => {
  const { execute, ssh, signal } = setup()
  ssh.connect.mockImplementationOnce(async () => { ssh.getPendingHostKey.mockReturnValue({ callbacks: { signal: signal.signal } }); throw new Error('host key') })
  expect(await execute(plan, 'run', signal.signal)).toMatchObject({ hosts: [{ status: 'failed', error: expect.stringContaining('手动验证') }] })
  expect(ssh.rejectHostKey).toHaveBeenCalledWith('host')
})
it('releases a late connection when cancellation races startup', async () => {
  const { execute, ssh, signal, service } = setup()
  ssh.connect.mockImplementationOnce(async () => { signal.abort(); return 'late' })
  await expect(execute(plan, 'run', signal.signal)).rejects.toThrow()
  expect(service.run).not.toHaveBeenCalled()
  expect(ssh.disconnect).toHaveBeenCalledWith('late')
})
it('cancels the model and transport when a running inspection is interrupted', async () => {
  const { execute, ssh, signal, service } = setup()
  service.run.mockImplementationOnce(async () => { signal.abort(); return { content: 'interrupted', toolRuns: [] } })
  await expect(execute(plan, 'run', signal.signal)).rejects.toThrow()
  expect(service.disposeOwner).toHaveBeenCalledWith('schedule:run')
  expect(ssh.disconnect).toHaveBeenCalledWith('dedicated')
})

it('opens and releases a separate transport and history for every host in an orchestration', async () => {
  const { execute, ssh, credentials, service, signal } = setup()
  credentials.getConnectionForAuth.mockImplementation((id: string) => ({ id }))
  ssh.connect.mockImplementation(async (connection: any) => `session-${connection.id}`)
  const result = await execute({ ...plan, connectionId: 'a', connectionIds: ['a','b'] }, 'multi', signal.signal)
  expect(service.run.mock.calls.map(call => (call as any[])[0].target.sessionId)).toEqual(['session-a','session-b'])
  expect(ssh.disconnect).toHaveBeenCalledWith('session-a')
  expect(ssh.disconnect).toHaveBeenCalledWith('session-b')
  expect(result.hosts?.map(host => host.status)).toEqual(['completed','completed'])
  expect(mocks.write.mock.calls.map(call => (call as any[])[0])).toEqual(['schedule:multi-0','schedule:multi-1'])
})

it('does not accept a healthy claim without tool evidence and strips the health marker from user text', async () => {
  const { execute, service, signal } = setup()
  service.run.mockResolvedValueOnce({ content: 'looks healthy\n<liteconnect-health>healthy</liteconnect-health>', toolRuns: [] })
  const result = await execute(plan, 'run', signal.signal)
  expect(result.health).toBe('unknown')
  expect(result.content).toBe('looks healthy')
})

it.each(['critical', 'warning'])('preserves %s health when another tool failed', async health => {
  const { execute, service, signal } = setup()
  service.run.mockResolvedValueOnce({ content: `disk issue\n<liteconnect-health>${health}</liteconnect-health>`, toolRuns: [
    { id: 't', name: 'exec', args: '{}', content: '{"exitCode":1}', status: 'done', isError: false },
  ] } as any)
  const result = await execute(plan, 'run', signal.signal)
  expect(result).toMatchObject({ health, hosts: [{ health, status: 'failed' }] })
})
