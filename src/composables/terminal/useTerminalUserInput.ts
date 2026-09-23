import type { Ref } from 'vue'

export type TerminalUserInputDeps = {
  sessionId: () => string
  readOnly: Ref<boolean>
  showReadOnlyHintOnce: () => void
  updatePasteState: (data: string) => void
  isPasting: () => boolean
  pulseCursor: () => void
  syncAfterTabCompletion: (originalInput: string, requireChange?: boolean) => boolean
  suggest: {
    suggestDismissed: Ref<boolean>
    suggestVisible: Ref<boolean>
    hideSuggest: () => void
  }
  capturedSubmitLine: Ref<string>
  getVisibleCommandLine: () => string
  scheduleSubmit: () => void
  cancelPendingSubmit: () => void
  resetCommandBuffer: () => void
  commandBuffer: Ref<string>
  commandBufferDirty: Ref<boolean>
  emitCdCommand: (command: string) => void
  getWriteQueueLength: () => number
  enqueueWrite: (data: string, sessionId: string) => void
  write: (data: string) => void
}

function isLocallyEchoable(data: string): boolean {
  if (data.length === 0) return false
  if (data.charCodeAt(0) === 0x1b) return false
  for (const ch of data) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function useTerminalUserInput(deps: TerminalUserInputDeps) {
  let tabCompletionInput: string | null = null

  function handleTerminalUserInput(data: string) {
    if (deps.readOnly.value) {
      deps.showReadOnlyHintOnce()
      return
    }
    deps.updatePasteState(data)

    if (data.length === 1 && isLocallyEchoable(data) && !deps.isPasting()) {
      deps.pulseCursor()
    }

    const isSubmit = data === '\r' || data === '\n'
    const isCancel = data === '\x03' || data === '\x15'
    const isBackspace = data === '\x7f' || data === '\x08'
    const isTab = data === '\t' || data === '\x09'
    const isEscape = data.charCodeAt(0) === 0x1b
    const hasNewline = data.includes('\r') || data.includes('\n')

    if (tabCompletionInput !== null && !isTab) {
      if (deps.syncAfterTabCompletion(tabCompletionInput, true)) {
        deps.suggest.suggestDismissed.value = false
      }
      tabCompletionInput = null
    }

    const plainChunk = data
      .replace(/\x1b\[200~/g, '')
      .replace(/\x1b\[201~/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')

    if (isSubmit) {
      deps.suggest.hideSuggest()
      deps.capturedSubmitLine.value = deps.getVisibleCommandLine().replace(/\[Pasted[^\]]*\]\s*/g, '')
      deps.scheduleSubmit()
    } else if (isCancel) {
      deps.cancelPendingSubmit()
      deps.resetCommandBuffer()
      deps.suggest.hideSuggest()
    } else if (isBackspace) {
      deps.suggest.suggestDismissed.value = false
      if (deps.commandBuffer.value.length > 0) deps.commandBuffer.value = deps.commandBuffer.value.slice(0, -1)
    } else if (data === '\x17') {
      deps.suggest.suggestDismissed.value = false
      deps.commandBuffer.value = deps.commandBuffer.value.replace(/\S+\s*$/, '')
    } else if (isTab) {
      deps.suggest.hideSuggest()
      tabCompletionInput = deps.commandBuffer.value || null
      deps.commandBufferDirty.value = true
    } else if (isLocallyEchoable(data) && !deps.isPasting()) {
      deps.suggest.suggestDismissed.value = false
      deps.commandBuffer.value += data
    } else if (isEscape) {
      if (deps.suggest.suggestVisible.value) {
        // Esc closes suggest only (handleKey); do not wipe buffer
      } else {
        deps.commandBuffer.value = ''
        deps.commandBufferDirty.value = true
      }
    } else if (hasNewline) {
      deps.suggest.hideSuggest()
      deps.commandBufferDirty.value = true
      const lines = plainChunk.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (/(?:^|[;&|]\s*)cd(?:\s|$)/.test(trimmed)) {
          setTimeout(() => {
            deps.emitCdCommand(trimmed)
          }, 50)
        }
      }
      deps.scheduleSubmit()
    }

    if (data.length > 32 || deps.getWriteQueueLength() > 0) {
      deps.enqueueWrite(data, deps.sessionId())
    } else {
      deps.write(data)
    }
  }

  function hasPendingTabCompletion() { return tabCompletionInput !== null }

  function syncPendingTabCompletion() {
    if (tabCompletionInput !== null && deps.syncAfterTabCompletion(tabCompletionInput, true)) {
      deps.suggest.suggestDismissed.value = false
    }
  }

  return { handleTerminalUserInput, hasPendingTabCompletion, syncPendingTabCompletion }
}
