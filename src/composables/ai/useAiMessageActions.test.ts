import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { appConfirm } from '@/composables/app/useAppDialog'
import { useAiMessageActions } from './useAiMessageActions'
import type { ChatItem } from '@/domain/ai/chat'

vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: vi.fn() }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.clearAllMocks() })

function fixture() {
  const sessionId = ref('host-a')
  const threadId = ref('thread-a')
  const blocked = ref(false)
  const loading = ref(false)
  const syncMessages = vi.fn()
  const regenerate = vi.fn(async (_session: string, _id: string, _sync: (messages: ChatItem[]) => void) => {})
  const remove = vi.fn(async () => true)
  const edit = vi.fn(async () => true)
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiMessageActions({
    sessionId: () => sessionId.value, threadId: () => threadId.value, blocked: () => blocked.value,
    loading, sessionLoading: () => false, syncMessages, regenerate, retry: regenerate, remove, edit, t: key => key,
  }))!
  return { api, sessionId, threadId, loading, syncMessages, regenerate, remove, edit, blocked }
}

it('does not delete from another thread after a delayed confirmation', async () => {
  let confirm!: () => void
  vi.mocked(appConfirm).mockImplementationOnce(() => new Promise(resolve => { confirm = () => resolve('confirm') }))
  const { api, threadId, remove } = fixture()
  const pending = api.handleDeleteMessage('old-message')
  threadId.value = 'new-thread'
  confirm()
  await pending
  expect(remove).not.toHaveBeenCalled()
})

it('ignores old stream projections and loading completion after switching hosts', async () => {
  const f = fixture()
  let finish!: () => void
  let update!: (messages: ChatItem[]) => void
  f.regenerate.mockImplementationOnce(async (_session, _id, sync) => {
    update = sync
    await new Promise<void>(resolve => { finish = resolve })
  })
  const pending = f.api.handleRegenerate('message')
  f.sessionId.value = 'host-b'
  f.loading.value = true
  update([])
  finish()
  await pending
  expect(f.syncMessages).not.toHaveBeenCalled()
  expect(f.loading.value).toBe(true)
})

it('finishes edit acknowledgement without starting a request when execution is blocked', async () => {
  const { api, edit, blocked } = fixture()
  blocked.value = true
  const done = vi.fn()
  await api.handleEditResend('message', 'new text', done)
  expect(done).toHaveBeenCalledWith(false)
  expect(edit).not.toHaveBeenCalled()
})
