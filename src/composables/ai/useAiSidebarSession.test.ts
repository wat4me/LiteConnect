import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import type { AiSessionState, ChatItem } from '@/domain/ai/chat'
import type { AiImageAttachment, AiSettings } from '@shared/types/ai'
import { useAiSidebarSession } from './useAiSidebarSession'

vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: vi.fn() }))
const notice = vi.hoisted(() => vi.fn())
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: notice } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.clearAllMocks() })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const message = (content: string): ChatItem => ({ id: content, role: 'user', content, createdAt: 1 })
function setup() {
  const sessionId = ref('a')
  const states = new Map(['a', 'b'].map(id => [id, reactive<AiSessionState>({
    messages: [message(id)], input: `draft-${id}`, activeThreadId: `thread-${id}`, threads: [],
    draftImages: [], loaded: false, loading: false, persisting: false, compactionCount: 0,
    activeRequestId: null, disposeAfterReply: false, contextFiles: [], defaultContextFiles: [],
  })]))
  const chat = {
    getSessionState: (id: string) => states.get(id)!,
    saveSessionInput: (id: string, text: string) => { states.get(id)!.input = text },
    refreshSettings: vi.fn(async () => ({} as AiSettings)),
    loadHistory: vi.fn(async (id: string) => { states.get(id)!.loaded = true; return states.get(id)!.messages }),
    sendText: vi.fn(async (_id: string, _text: string, _sync: (items: ChatItem[]) => void, _images?: AiImageAttachment[]) => true),
    stopGeneration: vi.fn(async (_id: string) => true), replaceSettings: vi.fn(),
  }
  const applySettings = vi.fn()
  const selection = ref<{ id: number; sessionId: string; text: string; mode: 'send' | 'insert' } | null>(null)
  const consumed = vi.fn()
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiSidebarSession({ chat, sessionId: () => sessionId.value,
    active: () => true, openGeneration: () => 0, selectionRequest: () => selection.value,
    selectionConsumed: consumed, canSend: () => true, sendBlocked: () => false,
    canCompact: () => true, compact: async () => {}, applySettings, t: key => key,
  }))!
  return { api, chat, states, sessionId, scope, selection, consumed, applySettings }
}

it('deduplicates initial preparation without replacing the next host projection', async () => {
  const f = setup()
  const pending = deferred<ChatItem[]>()
  f.chat.loadHistory.mockReturnValueOnce(pending.promise)
  const first = f.api.ensureOpenPrepared()
  const second = f.api.ensureOpenPrepared()
  await vi.waitFor(() => expect(f.chat.loadHistory).toHaveBeenCalledTimes(1))
  f.sessionId.value = 'b'
  await nextTick()
  pending.resolve([message('late-a')])
  await Promise.all([first, second])
  expect(f.api.messages.value.map(item => item.content)).toEqual(['b'])
  expect(f.api.input.value).toBe('draft-b')
})

it.each(['host', 'host-round-trip', 'thread', 'unmount'] as const)('does not project a delayed send after %s changes', async change => {
  const f = setup()
  const pending = deferred<boolean>()
  let project!: (items: ChatItem[]) => void
  f.chat.sendText.mockImplementationOnce(async (_id, _text, sync) => { project = sync; return pending.promise })
  const sending = f.api.handleSendText('question')
  if (change === 'host') f.sessionId.value = 'b'
  else if (change === 'host-round-trip') { f.sessionId.value = 'b'; f.sessionId.value = 'a' }
  else if (change === 'thread') {
    f.states.get('a')!.activeThreadId = 'another-thread'
    f.states.get('a')!.messages = [message('another-thread')]
    f.api.syncFromState()
  } else f.scope.stop()
  project([message('old-stream')])
  pending.resolve(true)
  await sending
  expect(f.api.messages.value.some(item => item.content === 'old-stream')).toBe(false)
})

it('restores failed text and images to their original hidden draft', async () => {
  const f = setup()
  const image: AiImageAttachment = { id: 'image', name: 'test.png', mimeType: 'image/png', width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' }
  f.states.get('a')!.draftImages.push(image)
  const pending = deferred<boolean>()
  f.chat.sendText.mockReturnValueOnce(pending.promise)
  const sending = f.api.sendMessage()
  f.sessionId.value = 'b'
  pending.reject(new Error('late failure'))
  await sending
  expect(f.states.get('a')!.input).toBe('draft-a')
  expect(f.states.get('a')!.draftImages).toEqual([image])
  expect(f.api.input.value).toBe('draft-b')
  expect(f.states.get('b')!.draftImages).toEqual([])
  expect(notice).not.toHaveBeenCalled()
})

it('does not restore failed attachments into another thread on the same host', async () => {
  const f = setup()
  const pending = deferred<boolean>()
  f.chat.sendText.mockReturnValueOnce(pending.promise)
  const sending = f.api.sendMessage()
  f.states.get('a')!.activeThreadId = 'new-thread'
  f.states.get('a')!.input = 'new draft'
  pending.resolve(false)
  await sending
  expect(f.api.input.value).toBe('new draft')
  expect(f.states.get('a')!.draftImages).toEqual([])
})

it('does not apply selection text when its host changes while history loads', async () => {
  const f = setup()
  const pending = deferred<ChatItem[]>()
  f.chat.loadHistory.mockReturnValueOnce(pending.promise)
  f.selection.value = { id: 1, sessionId: 'a', text: 'selected command', mode: 'send' }
  await vi.waitFor(() => expect(f.chat.loadHistory).toHaveBeenCalledTimes(1))
  f.sessionId.value = 'b'
  pending.resolve([])
  await nextTick()
  await nextTick()
  expect(f.chat.sendText).not.toHaveBeenCalled()
  expect(f.consumed).not.toHaveBeenCalled()
  expect(f.api.input.value).toBe('draft-b')
})

it('does not update UI settings after disposal and retries a failed history load', async () => {
  const f = setup()
  f.chat.loadHistory.mockRejectedValueOnce(new Error('temporary history failure'))
  await expect(f.api.ensureInitialLoad()).rejects.toThrow('temporary history failure')
  await f.api.ensureInitialLoad()
  expect(f.chat.loadHistory).toHaveBeenCalledTimes(2)
  const pending = deferred<AiSettings>()
  const other = setup()
  other.chat.refreshSettings.mockReturnValueOnce(pending.promise)
  const opening = other.api.ensureInitialLoad()
  other.scope.stop()
  pending.resolve({} as AiSettings)
  await opening
  expect(other.applySettings).not.toHaveBeenCalled()
  expect(other.chat.loadHistory).not.toHaveBeenCalled()
})

it('hydrates the original conversation from history when the facade returns unprojected records', async () => {
  const f = setup()
  f.states.get('a')!.messages = []
  f.chat.loadHistory.mockImplementationOnce(async id => {
    f.states.get(id)!.loaded = true
    return [message('persisted history')]
  })
  await f.api.ensureOpenPrepared()
  expect(f.api.messages.value.map(item => item.content)).toEqual(['persisted history'])
})

it('initializes the first thread before clearing its draft and restores a failed first send', async () => {
  const f = setup()
  f.states.get('a')!.activeThreadId = ''
  f.chat.loadHistory.mockImplementationOnce(async id => {
    f.states.get(id)!.loaded = true
    f.states.get(id)!.activeThreadId = 'fresh-thread'
    return []
  })
  f.chat.sendText.mockResolvedValueOnce(false)
  await f.api.sendMessage()
  expect(f.chat.sendText).toHaveBeenCalledExactlyOnceWith('a', 'draft-a', expect.any(Function), [])
  expect(f.api.input.value).toBe('draft-a')
  expect(f.api.loading.value).toBe(false)
})
