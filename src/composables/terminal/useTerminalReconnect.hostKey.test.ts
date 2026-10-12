import { afterEach, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '@shared/sshHostKeyConfirmation'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
import { useTerminalReconnect } from './useTerminalReconnect'

afterEach(() => vi.useRealTimers())

it('pauses retries while host trust is pending without printing a reconnect failure', () => {
  vi.useFakeTimers()
  const writeln = vi.fn()
  const emitReconnect = vi.fn()
  const state = useTerminalReconnect({
    sessionId: () => 's1', connectionId: () => 'c1', connectionName: () => 'Server',
    isActive: () => true, workspaceVisible: () => true, startDisconnected: false,
    getTerminal: () => ({ writeln } as unknown as Terminal), flushRenderBatch: vi.fn(),
    performResize: vi.fn(), scheduleTerminalRefresh: vi.fn(), emitReconnect,
  })
  state.noteDisconnectedAndMaybeReconnect({ message: 'Connection lost' })
  writeln.mockClear()
  state.onReconnectFailed(new CustomEvent('ssh-reconnect-failed', {
    detail: { sessionId: 's1', message: SSH_HOST_KEY_CONFIRMATION_REQUIRED, nonRetryable: true },
  }))
  expect(state.disconnected.value).toBe(true)
  expect(state.reconnecting.value).toBe(false)
  expect(writeln).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60_000)
  expect(emitReconnect).not.toHaveBeenCalled()
  state.dispose()
})
