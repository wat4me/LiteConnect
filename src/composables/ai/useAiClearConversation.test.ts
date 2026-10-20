import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import type { SshMcpJobSummary } from '@shared/mcp/types'
import { useAiClearConversation } from './useAiClearConversation'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), warning: vi.fn(), success: vi.fn() }))
vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: mocks.confirm }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: mocks.warning, success: mocks.success } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.clearAllMocks(); vi.unstubAllGlobals() })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
function setup() {
  const session = ref('a'), thread = ref('thread-a'), blocked = ref(false), hasMessages = ref(true)
  const jobs = vi.fn(async () => [] as SshMcpJobSummary[])
  const suppress = vi.fn(async () => {})
  vi.stubGlobal('window', { LiteConnect: { mcpListJobs: jobs, aiSuppressBackgroundReplies: suppress } })
  const clear = vi.fn(async (_id: string, sync: (messages: ChatItem[]) => void) => { sync([]); return true })
  const sync = vi.fn(), cleared = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiClearConversation({ sessionId: () => session.value, threadId: () => thread.value,
    blocked: () => blocked.value, hasMessages: () => hasMessages.value,
    targetSessionIds: () => [session.value], jobIds: () => ['owned-job'],
    clear, syncMessages: sync, cleared, t: key => key,
  }))!
  mocks.confirm.mockResolvedValue('confirm')
  return { api, session, thread, blocked, hasMessages, jobs, suppress, clear, sync, cleared, scope }
}

it('clears only the reviewed conversation and suppresses old background delivery first', async () => {
  const f = setup()
  f.jobs.mockResolvedValue([{ jobId: 'unrelated-job', sessionId: 'a', status: 'running' } as SshMcpJobSummary])
  await f.api.handleClearConversation()
  expect(f.suppress).toHaveBeenCalledWith('a', 'thread-a')
  expect(f.clear).toHaveBeenCalledExactlyOnceWith('a', expect.any(Function))
  expect(f.suppress.mock.invocationCallOrder[0]).toBeLessThan(f.clear.mock.invocationCallOrder[0])
  expect(f.sync).toHaveBeenCalledWith([])
  expect(f.cleared).toHaveBeenCalledOnce()
  expect(f.api.clearingConversation.value).toBe(false)
})

it('keeps data and background delivery untouched when confirmation is cancelled', async () => {
  const f = setup()
  mocks.confirm.mockRejectedValueOnce('cancel')
  await f.api.handleClearConversation()
  expect(f.suppress).not.toHaveBeenCalled()
  expect(f.clear).not.toHaveBeenCalled()
  expect(f.api.clearingConversation.value).toBe(false)
})

it.each(['host', 'thread', 'unmount'] as const)('does not clear after the %s changes during confirmation', async change => {
  const f = setup()
  const confirmation = deferred<string>()
  mocks.confirm.mockReturnValueOnce(confirmation.promise)
  const pending = f.api.handleClearConversation()
  await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  if (change === 'host') f.session.value = 'b'
  else if (change === 'thread') f.thread.value = 'thread-b'
  else f.scope.stop()
  confirmation.resolve('confirm')
  await pending
  expect(f.suppress).not.toHaveBeenCalled()
  expect(f.clear).not.toHaveBeenCalled()
})

it('requires active conversation jobs to finish without cancelling them or clearing data', async () => {
  const f = setup()
  f.jobs.mockResolvedValue([{ jobId: 'owned-job', sessionId: 'a', status: 'running' } as SshMcpJobSummary])
  await f.api.handleClearConversation()
  expect(mocks.warning).toHaveBeenCalledWith('ai.clearConversationJobsRunning')
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(f.clear).not.toHaveBeenCalled()
  expect(f.suppress).not.toHaveBeenCalled()
})

it('does not clear empty or busy conversations and prevents duplicate submissions', async () => {
  const f = setup()
  f.hasMessages.value = false
  await f.api.handleClearConversation()
  f.hasMessages.value = true
  f.blocked.value = true
  await f.api.handleClearConversation()
  expect(f.jobs).not.toHaveBeenCalled()
  f.blocked.value = false
  const confirmation = deferred<string>()
  mocks.confirm.mockReturnValueOnce(confirmation.promise)
  const pending = f.api.handleClearConversation()
  await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
  await f.api.handleClearConversation()
  confirmation.resolve('confirm')
  await pending
  expect(f.clear).toHaveBeenCalledOnce()
})

it('does not report success after a persistence failure', async () => {
  const f = setup()
  f.clear.mockResolvedValueOnce(false)
  await f.api.handleClearConversation()
  expect(f.cleared).not.toHaveBeenCalled()
  expect(mocks.success).not.toHaveBeenCalled()
  expect(f.api.clearingConversation.value).toBe(false)
})
