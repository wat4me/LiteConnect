import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppRuntimeSettings } from '@shared/types/settings'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '@shared/sshHostKeyConfirmation'
import { clearAutoReconnectAttempts, getAutoReconnectAttempt } from '@/composables/session/useAutoReconnectBudget'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))
import { useTerminalReconnect } from './useTerminalReconnect'

let listener: (settings: AppRuntimeSettings) => void
let dispose: () => void
const unsubscribe = vi.fn()
beforeEach(() => {
  vi.useFakeTimers(); clearAutoReconnectAttempts('server'); unsubscribe.mockClear()
  vi.stubGlobal('window', { LiteConnect: {
    getAutoReconnectEnabled: async () => true, getAutoReconnectMaxRetries: async () => 5,
    onRuntimeSettingsChanged: (callback: typeof listener) => { listener = callback; return unsubscribe },
  } })
})
afterEach(() => { dispose?.(); vi.useRealTimers(); vi.unstubAllGlobals() })
async function setup() {
  const emitReconnect = vi.fn()
  const state = useTerminalReconnect({
    sessionId: () => 'terminal', connectionId: () => 'server', connectionName: () => 'Server',
    isActive: () => true, workspaceVisible: () => true, startDisconnected: false,
    getTerminal: () => null, flushRenderBatch: vi.fn(), performResize: vi.fn(), scheduleTerminalRefresh: vi.fn(), emitReconnect,
  })
  dispose = state.dispose
  await state.loadAutoReconnectSettings()
  return { ...state, emitReconnect }
}
function settings(enabled: boolean, max = 5) {
  listener({ monitorEnabled: true, autoReconnectEnabled: enabled, autoReconnectMaxRetries: max })
}

it('cancels a queued retry when disabled and does not spend its retry budget', async () => {
  const state = await setup()
  state.noteDisconnectedAndMaybeReconnect()
  settings(false)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).not.toHaveBeenCalled()
  expect(state.reconnecting.value).toBe(false)
  expect(getAutoReconnectAttempt('server', 'terminal')).toBe(0)
  settings(true)
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.emitReconnect).toHaveBeenCalledOnce()
})

it('applies a lowered limit to queued retries and resumes only when the limit permits', async () => {
  const state = await setup()
  state.noteDisconnectedAndMaybeReconnect()
  await vi.advanceTimersByTimeAsync(1500)
  state.onReconnectFailed(new CustomEvent('ssh-reconnect-failed', { detail: { sessionId: 'terminal', message: 'network unavailable' } }))
  settings(true, 1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).toHaveBeenCalledOnce()
  expect(state.autoReconnectExhausted.value).toBe(true)
  settings(true, 2)
  await vi.advanceTimersByTimeAsync(3000)
  expect(state.emitReconnect).toHaveBeenCalledTimes(2)
})

it.each(['manual cancel', 'host trust', 'permanent error'])('does not resume a paused session after %s', async reason => {
  const state = await setup()
  state.noteDisconnectedAndMaybeReconnect()
  if (reason === 'manual cancel') state.cancelAutoReconnect()
  else if (reason === 'permanent error') state.applyNonRetryableError('Permission denied')
  else state.onReconnectFailed(new CustomEvent('ssh-reconnect-failed', { detail: { sessionId: 'terminal', message: SSH_HOST_KEY_CONFIRMATION_REQUIRED } }))
  settings(false); settings(true, 10)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).not.toHaveBeenCalled()
})

it('does not duplicate a retry already in flight when settings change', async () => {
  const state = await setup()
  state.noteDisconnectedAndMaybeReconnect()
  await vi.advanceTimersByTimeAsync(1500)
  settings(false); settings(true, 10)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).toHaveBeenCalledOnce()
  state.markReconnectedInPlace()
  settings(true, 20)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).toHaveBeenCalledOnce()
})

it('treats zero retries as disabled and can resume after raising the limit', async () => {
  const state = await setup()
  settings(true, 0)
  state.noteDisconnectedAndMaybeReconnect()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).not.toHaveBeenCalled()
  expect(state.autoReconnectExhausted.value).toBe(false)
  settings(true, 1)
  await vi.advanceTimersByTimeAsync(1500)
  expect(state.emitReconnect).toHaveBeenCalledOnce()
})

it('ignores a stale initial settings read and removes its listener on disposal', async () => {
  let resolve!: (value: boolean) => void
  window.LiteConnect.getAutoReconnectEnabled = () => new Promise(accept => { resolve = accept })
  const pending = setup()
  settings(false)
  resolve(true)
  const state = await pending
  state.noteDisconnectedAndMaybeReconnect()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(state.emitReconnect).not.toHaveBeenCalled()
  state.dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  dispose = () => {}
})
