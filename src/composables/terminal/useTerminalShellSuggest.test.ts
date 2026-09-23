import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalShellSuggest } from './useTerminalShellSuggest'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

afterEach(() => vi.unstubAllGlobals())

describe('terminal command suggestions', () => {
  it('fills a selected command on Enter and only allows submission on a second Enter', async () => {
    const sshWrite = vi.fn()
    vi.stubGlobal('window', {
      LiteConnect: {
        sshWrite,
        getTerminalCommandSuggestEnabled: async () => true,
        listShellCommandHistory: async () => [],
      },
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const commandBuffer = ref('cd /d')
    const suggest = useTerminalShellSuggest({
      terminalRef: ref(undefined),
      getTerminal: () => null,
      connectionId: () => 'connection',
      sessionId: () => 'session',
      isEffectiveActive: () => true,
      disconnected: ref(false),
      commandBuffer,
      commandBufferDirty: ref(false),
      cdBookmarks: () => [{ name: 'danger', path: '/danger' }],
    })
    await suggest.loadCommandSuggestSetting()
    expect(suggest.suggestItems.value[0]?.command).toBe('cd /danger')
    suggest.suggestActiveIndex.value = 0

    const preventDefault = vi.fn()
    const enter = {
      type: 'keydown', key: 'Enter', shiftKey: false, ctrlKey: false,
      metaKey: false, altKey: false, preventDefault,
    } as unknown as KeyboardEvent
    expect(suggest.handleSuggestKey(enter)).toBe(false)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(commandBuffer.value).toBe('cd /danger')
    expect(sshWrite).toHaveBeenCalledWith('session', 'anger')
    expect(sshWrite.mock.calls.some(([, payload]) => payload.includes('\r') || payload.includes('\n'))).toBe(false)

    await nextTick()
    expect(suggest.handleSuggestKey(enter)).toBe(true)
    expect(sshWrite).toHaveBeenCalledTimes(1)
    suggest.dispose()
  })
})
