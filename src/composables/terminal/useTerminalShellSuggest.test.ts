import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalShellSuggest } from './useTerminalShellSuggest'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

  it('rejects a localized command error arriving after 1500 ms', async () => {
    vi.useFakeTimers()
    const pushShellCommandHistory = vi.fn(async () => [])
    vi.stubGlobal('window', { LiteConnect: { pushShellCommandHistory } })
    const suggest = useTerminalShellSuggest({
      terminalRef: ref(undefined),
      getTerminal: () => null,
      connectionId: () => 'connection',
      sessionId: () => 'session',
      isEffectiveActive: () => true,
      disconnected: ref(false),
      commandBuffer: ref(''),
      commandBufferDirty: ref(false),
    })

    suggest.scheduleHistorySniff('odkcer ps -a')
    vi.advanceTimersByTime(1500)
    suggest.feedHistorySniff('odkcer ps -a\r\n')
    vi.advanceTimersByTime(700)
    suggest.feedHistorySniff('bash: odkcer: 未找到命令...\r\n')
    vi.advanceTimersByTime(7000)
    expect(pushShellCommandHistory).not.toHaveBeenCalled()

    suggest.scheduleHistorySniff('docker ps -a')
    vi.advanceTimersByTime(1500)
    suggest.feedHistorySniff('CONTAINER ID   IMAGE\r\n')
    vi.advanceTimersByTime(999)
    expect(pushShellCommandHistory).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(pushShellCommandHistory).toHaveBeenCalledWith('connection', 'docker ps -a')
    suggest.dispose()
  })
})
