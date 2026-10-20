import { afterEach, expect, it, vi } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { appPrompt } from '@/composables/app/useAppDialog'
import { useAiSidebarContextFiles } from './useAiSidebarContextFiles'
import type { AiConversationContextFile } from '@shared/types/ai'

vi.mock('@/composables/app/useAppDialog', () => ({ appConfirm: vi.fn(async () => 'confirm'), appPrompt: vi.fn(async () => '/note.md') }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.unstubAllGlobals(); vi.clearAllMocks() })

function fixture() {
  const sessionId = ref('host-a')
  const threadId = ref('thread-a')
  const ipc = {
    aiSelectLocalContextFile: vi.fn(async (): Promise<AiConversationContextFile | null> => null),
    sftpReadFile: vi.fn(async () => '# original'),
  }
  vi.stubGlobal('window', { LiteConnect: ipc })
  const setFile = vi.fn(async () => true)
  const scope = effectScope(); scopes.push(scope)
  const api = scope.run(() => useAiSidebarContextFiles({
    sessionId: () => sessionId.value, threadId: () => threadId.value, loading: () => false,
    active: () => true, openGeneration: () => 0, files: computed(() => []),
    ensureLoaded: async () => {}, setFile, removeFile: async () => true, t: key => key,
  }))!
  return { sessionId, threadId, ipc, scope, setFile, api }
}

it('does not attach a local selection to a host opened while the picker was pending', async () => {
  const f = fixture()
  let choose!: (file: AiConversationContextFile) => void
  f.ipc.aiSelectLocalContextFile.mockImplementationOnce(() => new Promise(resolve => { choose = resolve }))
  const pending = f.api.chooseLocalContextFile()
  await vi.waitFor(() => expect(f.ipc.aiSelectLocalContextFile).toHaveBeenCalledOnce())
  f.sessionId.value = 'host-b'
  choose({ source: 'local', path: 'C:/note.md', content: '# local' })
  await pending
  expect(f.setFile).not.toHaveBeenCalled()
  expect(f.api.contextFileBusy.value).toBe(false)
})

it.each(['thread-change', 'dispose'])('discards a late SSH file after %s', async kind => {
  const f = fixture()
  vi.mocked(appPrompt).mockResolvedValueOnce('/note.md')
  let read!: (content: string) => void
  f.ipc.sftpReadFile.mockImplementationOnce(() => new Promise(resolve => { read = resolve }))
  const pending = f.api.chooseSshContextFile()
  await vi.waitFor(() => expect(f.ipc.sftpReadFile).toHaveBeenCalledWith('host-a', '/note.md'))
  if (kind === 'dispose') f.scope.stop(); else f.threadId.value = 'thread-b'
  read('# late file')
  await pending
  expect(f.setFile).not.toHaveBeenCalled()
})

it('attaches a valid file through the original chat facade port', async () => {
  const f = fixture()
  await f.api.chooseSshContextFile()
  expect(f.setFile).toHaveBeenCalledWith('host-a', { source: 'ssh', path: '/note.md', content: '# original' })
})
