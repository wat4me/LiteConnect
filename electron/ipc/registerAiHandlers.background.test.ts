import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), run: vi.fn(), read: vi.fn(), save: vi.fn(), sender: null as any }))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
  BrowserWindow: { fromWebContents: () => undefined },
  webContents: { fromId: () => mocks.sender },
}))
vi.mock('../ai/history/historyStore', () => ({ readAiSessionStore: mocks.read, upsertAiHistoryRecord: mocks.save, writeAiContextCheckpoint: vi.fn() }))
vi.mock('../ai/execution/chatStream', async importOriginal => ({ ...await importOriginal<typeof import('../ai/execution/chatStream')>(), runAiChatStream: mocks.run }))

it('resumes the original conversation from a main-process completion without renderer polling', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 7, send: vi.fn(), isDestroyed: () => false })
  mocks.sender = sender
  const records: any[] = [{ id: 'user', role: 'user', content: 'restart the container', createdAt: 1 }]
  const store = { version: 1, activeThreadId: 'thread-a', defaultContextFiles: [], threads: [{ id: 'thread-a', contextFiles: [], messages: records }] }
  mocks.read.mockImplementation(async () => store)
  mocks.save.mockImplementation(async (_history: string, record: any, threadId: string) => {
    expect(threadId).toBe('thread-a')
    const index = records.findIndex(item => item.id === record.id)
    if (index < 0) records.push(record)
    else records[index] = record
  })
  const job: any = { jobId: 'job-a', sessionId: 'ssh-a', command: 'restart-container', status: 'running', startedAt: 2 }
  let settled: (job: any) => void = () => {}
  const runtime: any = { getJobResult: () => ({ ...job }), hasSession: () => true, onJobSettled: (callback: typeof settled) => { settled = callback } }
  let finish: () => void = () => {}
  mocks.run.mockImplementationOnce(async opts => {
    opts.onBackgroundJobsStarted(['job-a'])
    await new Promise<void>(resolve => { finish = resolve })
    return { content: 'Started the background command.' }
  }).mockImplementationOnce(async opts => {
    expect(opts.sessionId).toBe('ssh-a')
    expect(opts.messages.at(-1).content).toContain('container is healthy')
    expect(opts.getToolPermission()).toBe('ask')
    return { content: 'Container restarted and verified.' }
  })
  const { registerAiHandlers } = await import('./registerAiHandlers')
  registerAiHandlers({ init: async () => {}, initMigrations: async () => {}, getAiSettings: () => ({}), getAiResolvedConfig: () => ({ apiKey: 'test-only', toolPermission: 'ask' }) } as any, runtime, () => 'host-a')
  const initial = mocks.handlers.get('ai:chatStream')!({ sender }, 'manual-request', [], { sessionId: 'ssh-a', threadId: 'thread-a', assistantMessageId: 'initial-assistant', createdAt: 2 })
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
  Object.assign(job, { status: 'completed', stdout: 'container is healthy', exitCode: 0 })
  settled({ ...job })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(mocks.run).toHaveBeenCalledTimes(1)
  finish(); await initial
  await vi.waitFor(() => expect(records.some(record => record.content === 'Container restarted and verified.')).toBe(true))
  expect(mocks.run).toHaveBeenCalledTimes(2)
  expect(records.filter(record => record.role === 'user')).toHaveLength(1)
  expect(records.at(-1).backgroundNotice).toContain('container is healthy')
  expect(sender.send.mock.calls.some(([channel, event]) => channel === 'ai:backgroundReply' && event.record.status === 'completed')).toBe(true)
  expect(sender.listenerCount('destroyed')).toBe(1) // One lifecycle observer per renderer, not per reply.
  sender.emit('destroyed')
})
