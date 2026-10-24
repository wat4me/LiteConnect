import { expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { TransferItem } from '@shared/types/sftp'
import { useAiFileTransfers } from './useAiFileTransfers'

function item(id: string, conversation = 'first', thread = 'thread'): TransferItem {
  return { id, sessionId: 'shared-ssh', fileName: id, localPath: `C:/${id}`, remotePath: `/${id}`, direction: 'download', status: 'downloading', total: 100, transferred: 25, origin: { source: 'ai', conversationId: conversation, threadId: thread } }
}
function setup() {
  const conversation = ref('first'), thread = ref('thread')
  const transfers = reactive(new Map<string, TransferItem>())
  const removeTransfer = vi.fn((id: string) => { transfers.delete(id) })
  const port = { transfers, removeTransfer, cancelTransfer: vi.fn(), getSpeed: vi.fn(() => 1024) }
  return { conversation, thread, transfers, port, state: useAiFileTransfers(() => conversation.value, () => thread.value, port) }
}

it('isolates conversations and threads even when they share the same SSH session', () => {
  const { state, conversation, thread, transfers } = setup()
  for (const entry of [item('a'), item('b', 'second'), item('c', 'first', 'older'), { ...item('ordinary'), origin: undefined }]) transfers.set(entry.id, entry)
  expect(state.items.value.map(([id]) => id)).toEqual(['a'])
  conversation.value = 'second'
  expect(state.items.value.map(([id]) => id)).toEqual(['b'])
  conversation.value = 'first'; thread.value = 'older'
  expect(state.items.value.map(([id]) => id)).toEqual(['c'])
})

it('updates byte progress reactively without polling and keeps terminal results visible', () => {
  const { state, transfers } = setup()
  transfers.set('a', item('a'))
  expect(state.progress.value).toBe(25)
  transfers.get('a')!.transferred = 75
  expect(state.progress.value).toBe(75)
  transfers.get('a')!.status = 'completed'
  expect(state.active.value).toHaveLength(0)
  expect(state.items.value).toHaveLength(1)
})

it('clears only finished transfers from this conversation and preserves running or unrelated work', () => {
  const { state, transfers, port } = setup()
  for (const entry of [item('active'), { ...item('done'), status: 'completed' as const }, { ...item('other', 'second'), status: 'completed' as const }]) transfers.set(entry.id, entry)
  state.clearFinished()
  expect([...transfers.keys()]).toEqual(['active', 'other'])
  state.cancel('active')
  expect(port.cancelTransfer).toHaveBeenCalledExactlyOnceWith('active')
  expect(state.getSpeed('active')).toBe(1024)
})
