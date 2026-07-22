import { ref } from 'vue'
import type { Terminal } from '@xterm/xterm'

export function useCommandBuffer(deps: {
  getTerminal: () => Terminal | null
  onCdCommand: (cmd: string) => void
  /** Fired after Enter / paste-with-newline submits a line (may be null if empty). */
  onSubmitted?: (cmd: string | null) => void
}) {
  const commandBuffer = ref('')
  const commandBufferDirty = ref(false)
  const capturedSubmitLine = ref('')

  let pendingSubmitTimer: ReturnType<typeof setTimeout> | null = null

  function stripTerminalSequences(text: string): string {
    return text
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\r/g, '\n')
  }

  function stripShellNotifications(line: string): string {
    return line.replace(/\[Pasted[^\]]*\]\s*/g, '')
  }

  function getVisibleCommandLine(): string {
    const terminal = deps.getTerminal()
    if (!terminal) return ''
    try {
      const activeBuffer = (terminal as any).buffer?.active
      if (!activeBuffer) return ''
      const cursorY = activeBuffer.baseY + activeBuffer.cursorY
      for (let offset = 0; offset < 5; offset++) {
        const line = activeBuffer.getLine(cursorY - offset)
        const text = line?.translateToString(true) ?? ''
        if (text.trim()) return text
      }
      return ''
    } catch {
      return ''
    }
  }

  function extractCommandFromLine(line: string): string {
    if (!line.trim()) return ''
    const separators = ['$ ', '# ', '> ', '% ']
    let lastSepIndex = -1
    for (const sep of separators) {
      const idx = line.lastIndexOf(sep)
      if (idx > lastSepIndex) lastSepIndex = idx
    }
    if (lastSepIndex !== -1) {
      return line.slice(lastSepIndex + 2).trim()
    }
    return line.trim()
  }

  function extractCommandFromVisibleLine(): string {
    return extractCommandFromLine(stripShellNotifications(getVisibleCommandLine()))
  }

  function inferSubmittedCommand(command: string): string {
    const trimmedCommand = command.trim()
    if (!trimmedCommand) return trimmedCommand
    const visibleLine = stripShellNotifications(getVisibleCommandLine())
    if (!visibleLine.trim()) return trimmedCommand
    const commandStart = visibleLine.lastIndexOf(trimmedCommand)
    if (commandStart !== -1) {
      return visibleLine.slice(commandStart).trim()
    }

    const firstToken = trimmedCommand.split(/\s+/)[0]
    if (!firstToken) return trimmedCommand

    const separators = ['$ ', '# ', '> ', '% ']
    let lastSepIndex = -1
    for (const sep of separators) {
      const idx = visibleLine.lastIndexOf(sep)
      if (idx > lastSepIndex) lastSepIndex = idx
    }
    if (lastSepIndex !== -1) {
      const candidate = visibleLine.slice(lastSepIndex + 2).trim()
      if (candidate.startsWith(firstToken)) {
        return candidate
      }
    }

    const tokenWithSpaces = ` ${firstToken} `
    const tokenAtEnd = ` ${firstToken}`
    const exactAtStart = visibleLine.startsWith(firstToken) ? 0 : -1
    const withSpacesIndex = visibleLine.lastIndexOf(tokenWithSpaces)
    const atEndIndex = visibleLine.endsWith(tokenAtEnd) ? visibleLine.length - tokenAtEnd.length : -1

    let fallbackStart = -1
    if (withSpacesIndex !== -1) {
      fallbackStart = withSpacesIndex + 1
    } else if (atEndIndex !== -1) {
      fallbackStart = atEndIndex + 1
    } else if (exactAtStart === 0) {
      fallbackStart = 0
    }

    if (fallbackStart !== -1) {
      const visibleCommand = visibleLine.slice(fallbackStart).trim()
      if (visibleCommand.startsWith(firstToken)) {
        return visibleCommand
      }
    }

    return trimmedCommand
  }

  function submitBufferedCommand(): string | null {
    let cmd = ''
    const submitLine = capturedSubmitLine.value
    capturedSubmitLine.value = ''

    if (commandBufferDirty.value) {
      if (submitLine.trim()) {
        cmd = extractCommandFromLine(submitLine)
      }
    } else if (commandBuffer.value.trim()) {
      cmd = inferSubmittedCommand(commandBuffer.value)
    }

    if (!cmd) {
      const visibleCmd = extractCommandFromVisibleLine()
      if (visibleCmd) {
        cmd = visibleCmd
      }
    }

    if (!cmd) {
      cmd = commandBuffer.value.trim()
    }

    const submittedCommand = cmd || null

    if (submittedCommand && /(?:^|[;&|]\s*)cd(?:\s|$)/.test(submittedCommand)) {
      setTimeout(() => {
        deps.onCdCommand(submittedCommand)
      }, 50)
    }

    commandBuffer.value = ''
    commandBufferDirty.value = false
    pendingSubmitTimer = null

    deps.onSubmitted?.(submittedCommand)

    return submittedCommand
  }

  function scheduleSubmit() {
    cancelPendingSubmit()
    pendingSubmitTimer = setTimeout(() => {
      submitBufferedCommand()
    }, 20)
  }

  function cancelPendingSubmit() {
    if (pendingSubmitTimer) {
      clearTimeout(pendingSubmitTimer)
      pendingSubmitTimer = null
    }
  }

  function resetCommandBuffer() {
    commandBuffer.value = ''
    commandBufferDirty.value = false
    capturedSubmitLine.value = ''
    cancelPendingSubmit()
  }

  return {
    commandBuffer,
    commandBufferDirty,
    capturedSubmitLine,
    submitBufferedCommand,
    stripTerminalSequences,
    getVisibleCommandLine,
    inferSubmittedCommand,
    extractCommandFromLine,
    extractCommandFromVisibleLine,
    scheduleSubmit,
    cancelPendingSubmit,
    resetCommandBuffer,
  }
}
