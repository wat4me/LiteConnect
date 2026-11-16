import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalUserInput } from './useTerminalUserInput'

afterEach(() => vi.useRealTimers())

function setup(queuedBytes = 0) {
  const commandBuffer = ref('')
  const commandBufferDirty = ref(false)
  const capturedSubmitLine = ref('')
  const readOnly = ref(false)
  const write = vi.fn()
  const onUserInput = vi.fn()
  const enqueueWrite = vi.fn()
  const emitCdCommand = vi.fn()
  const scheduleSubmit = vi.fn()
  const showReadOnlyHintOnce = vi.fn()
  const notePromptBeforeInput = vi.fn()
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
    getVisibleCommandLine: () => 'echo hello', notePromptBeforeInput, scheduleSubmit,
    cancelPendingSubmit: vi.fn(), resetCommandBuffer: () => { commandBuffer.value = '' },
    commandBuffer, commandBufferDirty, emitCdCommand,
    getWriteQueueLength: () => queuedBytes, enqueueWrite, write, onUserInput,
  })
  return { input, commandBuffer, capturedSubmitLine, readOnly, write, enqueueWrite, onUserInput,
    emitCdCommand, scheduleSubmit, showReadOnlyHintOnce, notePromptBeforeInput, syncAfterTabCompletion }
}

describe('terminal user input', () => {
  it.each(['\x03', '\x15'])('sends cancel input %j without reading the prompt or resolving Tab completion', data => {
    const state = setup()
    state.commandBuffer.value = 'draft'
    state.input.handleTerminalUserInput('\t')
    expect(state.input.hasPendingTabCompletion()).toBe(true)
    state.notePromptBeforeInput.mockClear()
    state.onUserInput.mockClear()
    state.write.mockClear()

    state.input.handleTerminalUserInput(data)

    expect(state.notePromptBeforeInput).not.toHaveBeenCalled()
    expect(state.syncAfterTabCompletion).not.toHaveBeenCalled()
    expect(state.input.hasPendingTabCompletion()).toBe(false)
    expect(state.commandBuffer.value).toBe('')
    expect(state.onUserInput).toHaveBeenCalledExactlyOnceWith(data)
    expect(state.write).toHaveBeenCalledExactlyOnceWith(data)
  })

  it('preserves the order of an interrupt behind queued terminal input', () => {
    const state = setup(64)
    state.input.handleTerminalUserInput('\x03')
    expect(state.write).not.toHaveBeenCalled()
    expect(state.enqueueWrite).toHaveBeenCalledExactlyOnceWith('\x03', 'session-1')
  })

  it('blocks writes in read-only mode and queues long chunks', () => {
    const state = setup()
    state.readOnly.value = true
    state.input.handleTerminalUserInput('x')
    expect(state.showReadOnlyHintOnce).toHaveBeenCalledOnce()
    expect(state.write).not.toHaveBeenCalled()
    expect(state.onUserInput).not.toHaveBeenCalled()
    state.readOnly.value = false
    state.input.handleTerminalUserInput('a'.repeat(33))
    expect(state.enqueueWrite).toHaveBeenCalledWith('a'.repeat(33), 'session-1')
    expect(state.onUserInput).toHaveBeenCalledExactlyOnceWith('a'.repeat(33))
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

  it('does not submit protected pasted newlines until a real Enter arrives', () => {
    vi.useFakeTimers()
    const state = setup()
    const payload = '\x1b[200~cd /tmp\recho hello\r\x1b[201~'
    state.input.handleTerminalUserInput(payload)
    expect(state.write).toHaveBeenCalledExactlyOnceWith(payload)
    vi.advanceTimersByTime(100)
    expect(state.emitCdCommand).not.toHaveBeenCalled()
    expect(state.scheduleSubmit).not.toHaveBeenCalled()
    state.input.handleTerminalUserInput('\r')
    expect(state.scheduleSubmit).toHaveBeenCalledOnce()
  })
})
