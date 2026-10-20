import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, onBeforeUnmount, onMounted } from 'vue'
import type { Connection } from '@shared/types/connection'
import type { AiWorkspaceConnectionEvent } from '@shared/aiWorkspace'
import type { AiWorkspaceConversationItem } from '@shared/aiWorkspaceConversations'
import { useAiWorkspace } from './useAiWorkspace'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), warning: vi.fn(), states: new Map<string, { activeThreadId: string; loading: boolean; threads: [] }>(), stop: vi.fn(), load: vi.fn(), switch: vi.fn() }))
vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onMounted: vi.fn(), onBeforeUnmount: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: object) => key + (params ? JSON.stringify(params) : '') }) }))
vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: mocks.confirm }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: mocks.warning } }))
vi.mock('@/composables/ai/useAiChat', () => ({ disposeAiSessionState: vi.fn(), useAiChat: () => ({
  getSessionState: (id: string) => {
    if (!mocks.states.has(id)) mocks.states.set(id, { activeThreadId: `thread-${id}`, loading: false, threads: [] })
    return mocks.states.get(id)!
  },
  switchConversation: mocks.switch, loadHistory: mocks.load, startNewConversation: vi.fn(), onReplyComplete: vi.fn(), stopGeneration: mocks.stop,
}) }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); mocks.states.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })

function setup() {
  let scopeId = 0
  const api = {
    aiListWorkspaceConversations: vi.fn(async () => [] as AiWorkspaceConversationItem[]),
    aiOpenWorkspaceConnection: vi.fn(async (id: string) => `ssh-${id}`),
    aiOpenWorkspaceScope: vi.fn(async (input: { connectionIds: string[] }) => ({ id: `workspace:${++scopeId}`, connectionIds: input.connectionIds, createdAt: 1 })),
    aiCloseWorkspaceConnection: vi.fn(async (_id: string) => {}),
    aiSuppressBackgroundReplies: vi.fn(async (_id: string, _threadId: string) => {}),
    getConnections: vi.fn(async () => [] as Connection[]),
    getGroups: vi.fn(async () => []),
    onAiWorkspaceConnection: vi.fn((_callback: (event: AiWorkspaceConnectionEvent) => void) => vi.fn()),
    aiCancelWorkspaceConnection: vi.fn(async (_id: string) => {}),
  }
  vi.stubGlobal('window', { LiteConnect: api, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  mocks.confirm.mockResolvedValue('confirm')
  mocks.stop.mockResolvedValue(true)
  const scope = effectScope(); scopes.push(scope)
  const workspace = scope.run(() => useAiWorkspace({ active: () => true }))!
  workspace.connections.value = ['a', 'b', 'c'].map(id => ({ id, name: `server-${id}`, host: `${id}.test`, port: 22, username: 'root', group: '', createdAt: 1, updatedAt: 1 }) as Connection)
  return { workspace, api }
}

it.each([false, true])('closes legacy and scoped conversations without releasing SSH or history (scoped=%s)', async scoped => {
  const { workspace, api } = setup()
  if (scoped) await workspace.openScope({ connectionIds: ['a', 'b'] })
  else await workspace.startChat(workspace.connections.value[0])
  const session = workspace.sessionId.value
  const connections = { ...workspace.sessions.value }
  await workspace.closeCurrentConversation()
  expect(workspace.browsing.value).toBe(true)
  expect(workspace.currentConversations.value).toHaveLength(0)
  expect(workspace.sessions.value).toEqual(connections)
  expect(api.aiCloseWorkspaceConnection).not.toHaveBeenCalled()
  expect(api.aiSuppressBackgroundReplies).toHaveBeenCalledWith(session, `thread-${session}`)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

it('ignores an earlier host refresh while the latest request is still pending', async () => {
  const { workspace, api } = setup()
  const hosts = [...workspace.connections.value]
  const older = deferred<Connection[]>()
  const newer = deferred<Connection[]>()
  api.getConnections.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  workspace.browserSelection.value = ['b']
  const first = workspace.refresh()
  const second = workspace.refresh()
  older.resolve([hosts[0]])
  await first
  expect(workspace.loading.value).toBe(true)
  expect(workspace.browserSelection.value).toEqual(['b'])
  newer.resolve([hosts[1]])
  await second
  expect(workspace.connections.value).toEqual([hosts[1]])
  expect(workspace.loading.value).toBe(false)
  expect(workspace.browserSelection.value).toEqual(['b'])
})

it('ignores a stale refresh failure after a newer refresh succeeds', async () => {
  const { workspace, api } = setup()
  const older = deferred<Connection[]>()
  api.getConnections.mockReturnValueOnce(older.promise).mockResolvedValueOnce([...workspace.connections.value])
  const first = workspace.refresh()
  await workspace.refresh()
  older.reject(new Error('outdated failure'))
  await first
  expect(workspace.error.value).toBe('')
})

it('does not restore an older history index over a newer response', async () => {
  const { workspace, api } = setup()
  api.getConnections.mockResolvedValue([...workspace.connections.value])
  const older = deferred<AiWorkspaceConversationItem[]>()
  const newer = deferred<AiWorkspaceConversationItem[]>()
  const recent = [{ connectionId: 'a', threadId: 'latest', title: 'latest', hostLabel: 'server-a', updatedAt: 1 }]
  api.aiListWorkspaceConversations.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)
  const first = workspace.refresh()
  await vi.waitFor(() => expect(api.aiListWorkspaceConversations).toHaveBeenCalledTimes(1))
  const second = workspace.refresh()
  await vi.waitFor(() => expect(api.aiListWorkspaceConversations).toHaveBeenCalledTimes(2))
  newer.resolve(recent)
  await second
  older.resolve([])
  await first
  expect(workspace.historyConversations.value).toEqual(recent)
})

it('ignores history responses and new refreshes after workspace disposal', async () => {
  const { workspace, api } = setup()
  api.getConnections.mockResolvedValue([...workspace.connections.value])
  const pending = deferred<AiWorkspaceConversationItem[]>()
  api.aiListWorkspaceConversations.mockImplementationOnce(() => pending.promise)
  const refresh = workspace.refresh()
  await vi.waitFor(() => expect(api.aiListWorkspaceConversations).toHaveBeenCalledTimes(1))
  const unmount = vi.mocked(onBeforeUnmount).mock.calls.at(-1)![0] as () => void
  unmount()
  pending.resolve([{ connectionId: 'a', threadId: 'late', title: 'late', hostLabel: 'server-a', updatedAt: 1 }])
  await refresh
  await workspace.refresh()
  expect(workspace.historyConversations.value).toEqual([])
  expect(api.getConnections).toHaveBeenCalledTimes(1)
})

it('locks conversation navigation while a workspace scope is being established', async () => {
  const { workspace, api } = setup()
  await workspace.startChat(workspace.connections.value[2])
  const pending = deferred<{ id: string; connectionIds: string[]; createdAt: number }>()
  api.aiOpenWorkspaceScope.mockReturnValueOnce(pending.promise)
  const opening = workspace.openScope({ connectionIds: ['a'] })
  await vi.waitFor(() => expect(api.aiOpenWorkspaceScope).toHaveBeenCalledTimes(1))
  expect(workspace.connectingId.value).toBe('')
  expect(workspace.selectionLocked.value).toBe(true)
  await workspace.startChat(workspace.connections.value[1])
  await workspace.openCurrent({ connectionId: 'b', sessionId: 'ssh-b' })
  await workspace.openHistory({ connectionId: 'b', threadId: 'old', title: 'old', hostLabel: 'server-b', updatedAt: 1 })
  workspace.hostPicker.value = 'create'
  workspace.pickerSelection.value = ['a']
  await workspace.pickHost(workspace.connections.value[1])
  expect(workspace.pickerSelection.value).toEqual(['a'])
  expect(workspace.selectedId.value).toBe('c')
  expect(api.aiOpenWorkspaceConnection.mock.calls.map(([id]) => id)).toEqual(['c', 'a'])
  pending.resolve({ id: 'workspace:new', connectionIds: ['a'], createdAt: 1 })
  await opening
  expect(workspace.activeScope.value?.connectionIds).toEqual(['a'])
  expect(workspace.selectionLocked.value).toBe(false)
})

it('does not clear a reconnected SSH session on stale close or cancellation events', async () => {
  const { workspace, api } = setup()
  const hosts = [...workspace.connections.value]
  api.getConnections.mockResolvedValue(hosts)
  const mount = vi.mocked(onMounted).mock.calls.at(-1)![0] as () => void
  mount()
  await vi.waitFor(() => expect(workspace.loading.value).toBe(false))
  const notify = api.onAiWorkspaceConnection.mock.calls[0][0]
  await workspace.openScope({ connectionIds: ['a'] })
  notify({ connectionId: 'a', sessionId: 'ssh-new', status: 'connected' })
  notify({ connectionId: 'a', sessionId: 'ssh-a', status: 'closed' })
  notify({ connectionId: 'a', status: 'cancelled' })
  expect(workspace.sessions.value.a).toBe('ssh-new')
  expect(workspace.scopeReady.value).toBe(true)
  notify({ connectionId: 'a', sessionId: 'ssh-new', status: 'closed' })
  expect(workspace.scopeReady.value).toBe(false)
})

it('keeps navigation locked while legacy history is loading after SSH has connected', async () => {
  const { workspace } = setup()
  const history = deferred<void>()
  mocks.load.mockReturnValueOnce(history.promise)
  const opening = workspace.startChat(workspace.connections.value[0], 'history-a')
  await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledWith('ssh-a'))
  expect(workspace.connectingId.value).toBe('')
  expect(workspace.selectionLocked.value).toBe(true)
  await workspace.startChat(workspace.connections.value[1], 'history-b')
  expect(workspace.selectedId.value).toBe('a')
  history.resolve()
  await opening
  expect(mocks.switch).toHaveBeenCalledExactlyOnceWith('ssh-a', 'history-a', expect.any(Function))
  expect(workspace.selectionLocked.value).toBe(false)
})

it('does not restore legacy history after its SSH connection closes during loading', async () => {
  const { workspace, api } = setup()
  api.getConnections.mockResolvedValue([...workspace.connections.value])
  const mount = vi.mocked(onMounted).mock.calls.at(-1)![0] as () => void
  mount()
  await vi.waitFor(() => expect(workspace.loading.value).toBe(false))
  const history = deferred<void>()
  mocks.load.mockReturnValueOnce(history.promise)
  const opening = workspace.startChat(workspace.connections.value[0], 'history-a')
  await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledWith('ssh-a'))
  api.onAiWorkspaceConnection.mock.calls[0][0]({ connectionId: 'a', sessionId: 'ssh-a', status: 'closed' })
  history.resolve()
  await opening
  expect(mocks.switch).not.toHaveBeenCalled()
  expect(workspace.browsing.value).toBe(true)
  expect(workspace.selectionLocked.value).toBe(false)
})

it('cancelling a disconnect leaves connections, replies and jobs untouched', async () => {
  const { workspace, api } = setup()
  await workspace.openScope({ connectionIds: ['a', 'b'] })
  mocks.confirm.mockRejectedValueOnce('cancel')
  await workspace.disconnect()
  expect(api.aiCloseWorkspaceConnection).not.toHaveBeenCalled()
  expect(api.aiSuppressBackgroundReplies).not.toHaveBeenCalled()
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(workspace.scopeReady.value).toBe(true)
  expect(workspace.closing.value).toBe(false)
})

it('disconnects only reviewed scope connections, suppresses shared replies and reports partial failures', async () => {
  const { workspace, api } = setup()
  await workspace.openScope({ connectionIds: ['a', 'b'] })
  const first = workspace.sessionId.value
  mocks.states.set(first, { activeThreadId: 'thread-shared', loading: true, threads: [] })
  await workspace.openScope({ connectionIds: ['a', 'c'] })
  const second = workspace.sessionId.value
  api.aiCloseWorkspaceConnection.mockImplementation(async id => { if (id === 'ssh-c') throw new Error('fixture close failure') })
  await workspace.disconnect()
  expect(mocks.confirm.mock.calls[0][0].message).toContain('"hosts":"server-a、server-c"')
  expect(mocks.confirm.mock.calls[0][0].detail).toContain('disconnectSshDetail')
  expect(api.aiCloseWorkspaceConnection.mock.calls.map(([id]) => id)).toEqual(['ssh-a', 'ssh-c'])
  expect(mocks.stop).toHaveBeenCalledWith(first)
  expect(api.aiSuppressBackgroundReplies).toHaveBeenCalledWith(first, 'thread-shared')
  expect(api.aiSuppressBackgroundReplies).toHaveBeenCalledWith(second, `thread-${second}`)
  expect(workspace.sessions.value).toEqual({ b: 'ssh-b', c: 'ssh-c' })
  expect(workspace.scopeReady.value).toBe(false)
  expect(mocks.warning).toHaveBeenCalledWith('ai.workspace.disconnectSshFailed')
})

it('refuses to close a running conversation without silently dropping its active reply', async () => {
  const { workspace, api } = setup()
  await workspace.openScope({ connectionIds: ['a'] })
  mocks.states.set(workspace.sessionId.value, { activeThreadId: 'running-thread', loading: true, threads: [] })
  await workspace.closeCurrentConversation()
  expect(workspace.currentConversations.value).toHaveLength(1)
  expect(api.aiSuppressBackgroundReplies).not.toHaveBeenCalled()
  expect(api.aiCloseWorkspaceConnection).not.toHaveBeenCalled()
})
