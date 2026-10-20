import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import type { SshMcpJobSummary } from '@shared/mcp/types'
import { useAiNewConversation } from './useAiNewConversation'

const dialogs = vi.hoisted(() => ({ confirm: vi.fn(), warning: vi.fn() }))
vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: dialogs.confirm }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: dialogs.warning } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.clearAllMocks(); vi.unstubAllGlobals() })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
const job = (id: string, sessionId = 'a') => ({ jobId: id, sessionId, status: 'running' }) as SshMcpJobSummary
function setup() {
  const session = ref('a')
  const thread = ref('thread-a')
  const jobs = vi.fn(async () => [job('job-a'), job('unrelated', 'b')])
  const suppress = vi.fn(async (_id: string, _threadId: string) => {})
  const cancel = vi.fn(async (_name: string, _args: object) => ({ isError: false, content: '' }))
  vi.stubGlobal('window', { LiteConnect: { mcpListJobs: jobs, aiSuppressBackgroundReplies: suppress, mcpCallTool: cancel } })
  const start = vi.fn(async (_id: string, _sync: (messages: ChatItem[]) => void) => true)
  const syncMessages = vi.fn()
  const syncFromState = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiNewConversation({ sessionId: () => session.value, threadId: () => thread.value,
    blocked: () => false, sessionLoading: () => false, targetSessionIds: () => [session.value], jobIds: () => undefined,
    start, syncMessages, syncFromState, t: key => key,
  }))!
  dialogs.confirm.mockResolvedValue('confirm')
  return { api, session, thread, scope, jobs, suppress, cancel, start, syncMessages, syncFromState }
}

it.each(['host', 'thread', 'unmount'] as const)('does not cancel jobs after the %s changes during confirmation', async change => {
  const f = setup()
  const confirmation = deferred<string>()
  dialogs.confirm.mockReturnValueOnce(confirmation.promise)
  const creating = f.api.handleNewConversation()
  await vi.waitFor(() => expect(dialogs.confirm).toHaveBeenCalledOnce())
  if (change === 'host') f.session.value = 'b'
  else if (change === 'thread') f.thread.value = 'another-thread'
  else f.scope.stop()
  confirmation.resolve('confirm')
  await creating
  expect(f.suppress).not.toHaveBeenCalled()
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.start).not.toHaveBeenCalled()
})

it('does not classify a delayed job snapshot using a different host', async () => {
  const f = setup()
  const snapshot = deferred<SshMcpJobSummary[]>()
  f.jobs.mockReturnValueOnce(snapshot.promise)
  const creating = f.api.handleNewConversation()
  f.session.value = 'b'
  snapshot.resolve([job('job-b', 'b')])
  await creating
  expect(dialogs.confirm).not.toHaveBeenCalled()
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.start).not.toHaveBeenCalled()
})

it('does not cancel jobs after switching away while background suppression is pending', async () => {
  const f = setup()
  const suppression = deferred<void>()
  f.suppress.mockReturnValueOnce(suppression.promise)
  const creating = f.api.handleNewConversation()
  await vi.waitFor(() => expect(f.suppress).toHaveBeenCalledOnce())
  f.session.value = 'b'
  suppression.resolve()
  await creating
  expect(f.cancel).not.toHaveBeenCalled()
  expect(f.start).not.toHaveBeenCalled()
})

it('cancels only the original conversation jobs and projects the newly created thread', async () => {
  const f = setup()
  f.start.mockImplementationOnce(async (_id, sync) => { f.thread.value = 'new-thread'; sync([]); return true })
  await f.api.handleNewConversation()
  expect(f.suppress).toHaveBeenCalledWith('a', 'thread-a')
  expect(f.cancel).toHaveBeenCalledExactlyOnceWith('cancel_job', { jobId: 'job-a' })
  expect(f.start).toHaveBeenCalledWith('a', expect.any(Function))
  expect(f.syncMessages).toHaveBeenCalledWith([])
  expect(f.syncFromState).toHaveBeenCalledOnce()
  expect(f.api.newConversationBusy.value).toBe(false)
})
