import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { AiSessionStore, AiThreadSummary } from '@shared/types/ai'
import type { ChatItem } from '@/domain/ai/chat'
import { useAiSidebarHistory } from './useAiSidebarHistory'

const dialogs = vi.hoisted(() => ({ confirm: vi.fn(), prompt: vi.fn() }))
vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: dialogs.confirm, appPrompt: dialogs.prompt }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { success: vi.fn() } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.clearAllMocks(); vi.unstubAllGlobals() })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
function store(content: string): AiSessionStore {
  return { version: 1, activeThreadId: 'old', defaultContextFiles: [], threads: [{ id: 'old',
    title: 'old', createdAt: 1, updatedAt: 1, contextFiles: [],
    messages: [{ id: content, role: 'user', content, createdAt: 1 }],
  }] }
}
function setup() {
  const session = ref('a')
  const thread = ref('old')
  const getStore = vi.fn(async (_id: string) => store('initial'))
  vi.stubGlobal('window', { LiteConnect: { getAiSessionStore: getStore } })
  const syncMessages = vi.fn()
  const syncFromState = vi.fn()
  const switchConversation = vi.fn(async (_id: string, _thread: string, _sync: (items: ChatItem[]) => void) => true)
  const remove = vi.fn(async () => true)
  const clear = vi.fn(async () => true)
  const update = vi.fn(async () => true)
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiSidebarHistory({ sessionId: () => session.value,
    activeThreadId: () => thread.value, threadSummaries: ref<AiThreadSummary[]>([
      { id: 'old', title: 'old', createdAt: 1, updatedAt: 1, messageCount: 1, active: true },
    ]), loading: ref(false), syncMessages, syncFromState,
    switchConversation, deleteConversation: remove, clearAllConversations: clear,
    updateConversation: update, closeModelSwitcher: () => {}, closeSettings: () => {}, t: key => key,
  }))!
  return { api, session, thread, scope, getStore, switchConversation, syncMessages, syncFromState, remove, clear, update }
}

it.each(['delete', 'rename', 'clear'] as const)('does not apply a %s confirmation to a different host', async operation => {
  const f = setup()
  const pending = deferred<string>()
  dialogs.confirm.mockReturnValueOnce(pending.promise)
  dialogs.prompt.mockReturnValueOnce(pending.promise)
  const action = operation === 'delete' ? f.api.handleDeleteConversation('old')
    : operation === 'rename' ? f.api.handleRenameConversation('old', 'old') : f.api.handleClearAllHistory()
  f.session.value = 'b'
  pending.resolve('confirmed title')
  await action
  expect(f.remove).not.toHaveBeenCalled()
  expect(f.clear).not.toHaveBeenCalled()
  expect(f.update).not.toHaveBeenCalled()
})

it('does not consume a confirmation after switching threads on the same host', async () => {
  const f = setup()
  const pending = deferred<string>()
  dialogs.confirm.mockReturnValueOnce(pending.promise)
  const removing = f.api.handleDeleteConversation('old')
  f.thread.value = 'another-thread'
  pending.resolve('confirm')
  await removing
  expect(f.remove).not.toHaveBeenCalled()
})

it('keeps the latest history search body when close/reopen requests finish out of order', async () => {
  const f = setup()
  const old = deferred<AiSessionStore>()
  f.getStore.mockReturnValueOnce(old.promise).mockResolvedValueOnce(store('latest search text'))
  const opening = f.api.openHistoryPanel()
  f.api.closeHistoryPanel()
  await f.api.openHistoryPanel()
  old.resolve(store('stale search text'))
  await opening
  f.api.historyQuery.value = 'latest search'
  expect(f.api.filteredHistoryItems.value).toHaveLength(1)
  f.api.historyQuery.value = 'stale search'
  expect(f.api.filteredHistoryItems.value).toHaveLength(0)
})

it.each(['host', 'unmount'] as const)('ignores delayed switch callbacks after %s changes', async change => {
  const f = setup()
  const pending = deferred<boolean>()
  let sync!: (items: ChatItem[]) => void
  f.switchConversation.mockImplementationOnce(async (_id, _thread, callback) => { sync = callback; return pending.promise })
  const switching = f.api.handleSwitchConversation('old')
  if (change === 'host') { f.session.value = 'b'; await f.api.openHistoryPanel() }
  else f.scope.stop()
  sync([])
  pending.resolve(true)
  await switching
  await nextTick()
  expect(f.syncMessages).not.toHaveBeenCalled()
  expect(f.syncFromState).not.toHaveBeenCalled()
  if (change === 'host') expect(f.api.showHistory.value).toBe(true)
})

it('leaves history open when switching fails and blocks a concurrent switch', async () => {
  const f = setup()
  await f.api.openHistoryPanel()
  const pending = deferred<boolean>()
  f.switchConversation.mockReturnValueOnce(pending.promise)
  const switching = f.api.handleSwitchConversation('old')
  await f.api.handleSwitchConversation('another')
  expect(f.switchConversation).toHaveBeenCalledTimes(1)
  pending.resolve(false)
  await switching
  expect(f.api.showHistory.value).toBe(true)
  expect(f.api.historyBusy.value).toBe(false)
})
