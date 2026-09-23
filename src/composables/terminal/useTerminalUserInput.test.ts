import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalUserInput } from './useTerminalUserInput'

afterEach(() => vi.useRealTimers())

function setup() {
  const commandBuffer = ref('')
  const commandBufferDirty = ref(false)
  const capturedSubmitLine = ref('')
  const readOnly = ref(false)
  const write = vi.fn()
  const enqueueWrite = vi.fn()
  const emitCdCommand = vi.fn()
  const scheduleSubmit = vi.fn()
  const showReadOnlyHintOnce = vi.fn()
  const syncAfterTabCompletion = vi.fn(() => true)
  const suggest = {
    suggestDismissed: ref(true),
    suggestVisible: ref(false),
    hideSuggest: vi.fn(),
  }
  const input = useTerminalUserInput({
    sessionId: () => 'session-1', readOnly, showReadOnlyHintOnce,
    updatePasteState: vi.fn(), isPasting: () => false, pulseCursor: vi.fn(),
    syncAfterTabCompletion, suggest, capturedSubmitLine,
    getVisibleCommandLine: () => 'echo hello', scheduleSubmit,
    cancelPendingSubmit: vi.fn(), resetCommandBuffer: () => { commandBuffer.value = '' },
    commandBuffer, commandBufferDirty, emitCdCommand,
    getWriteQueueLength: () => 0, enqueueWrite, write,
  })
  return { input, commandBuffer, capturedSubmitLine, readOnly, write, enqueueWrite,
    emitCdCommand, scheduleSubmit, showReadOnlyHintOnce, syncAfterTabCompletion }
}

describe('terminal user input', () => {
  it('blocks writes in read-only mode and queues long chunks', () => {
    const state = setup()
    state.readOnly.value = true
    state.input.handleTerminalUserInput('x')
    expect(state.showReadOnlyHintOnce).toHaveBeenCalledOnce()
    expect(state.write).not.toHaveBeenCalled()
    state.readOnly.value = false
    state.input.handleTerminalUserInput('a'.repeat(33))
    expect(state.enqueueWrite).toHaveBeenCalledWith('a'.repeat(33), 'session-1')
  })

  it('tracks tab completion and submits the visible command line', () => {
    const state = setup()
    state.input.handleTerminalUserInput('e')
    state.input.handleTerminalUserInput('\t')
    expect(state.input.hasPendingTabCompletion()).toBe(true)
    state.input.syncPendingTabCompletion()
    expect(state.syncAfterTabCompletion).toHaveBeenCalledWith('e', true)
    state.input.handleTerminalUserInput('\r')
    expect(state.capturedSubmitLine.value).toBe('echo hello')
    expect(state.scheduleSubmit).toHaveBeenCalledOnce()
  })

  it('reports pasted cd commands after the input is written', () => {
    vi.useFakeTimers()
    const state = setup()
    state.input.handleTerminalUserInput('cd /tmp\n')
    expect(state.write).toHaveBeenCalledWith('cd /tmp\n')
    vi.advanceTimersByTime(50)
    expect(state.emitCdCommand).toHaveBeenCalledWith('cd /tmp')
  })
})
