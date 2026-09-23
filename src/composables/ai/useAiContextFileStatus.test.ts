import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useAiContextFileStatus } from './useAiContextFileStatus'

afterEach(() => vi.unstubAllGlobals())

describe('useAiContextFileStatus', () => {
  it('ignores an older result after the active session changes', async () => {
    let finishOld!: (value: { isDirectory: boolean }) => void
    const oldResult = new Promise<{ isDirectory: boolean }>((resolve) => { finishOld = resolve })
    vi.stubGlobal('window', {
      LiteConnect: {
        sftpStat: vi.fn((sessionId: string) => sessionId === 'old'
          ? oldResult : Promise.resolve({ isDirectory: false })),
      },
    })
    const sessionId = ref('old')
    const active = ref(true)
    const scope = effectScope()
    const status = scope.run(() => useAiContextFileStatus({
      sessionId: () => sessionId.value,
      active: () => active.value,
      openGeneration: () => 0,
      files: computed(() => [{ source: 'ssh' as const, path: '/note.md', content: '' }]),
    }))!

    sessionId.value = 'new'
    await nextTick()
    await Promise.resolve()
    expect(status.contextFileSourceStatus.value['ssh:/note.md']).toBe('available')

    finishOld({ isDirectory: true })
    await oldResult
    await Promise.resolve()
    expect(status.contextFileSourceStatus.value['ssh:/note.md']).toBe('available')

    active.value = false
    await nextTick()
    expect(status.contextFileSourceStatus.value).toEqual({})
    scope.stop()
  })
})
