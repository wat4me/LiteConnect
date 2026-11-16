import { ref } from 'vue'
import type { IBufferLine, Terminal } from '@xterm/xterm'
import { promptTerminator } from '@/utils/terminal/shellHistoryEligibility'

/** How a submitted line may be used for local command history. */
export type SubmittedCommandInfo = {
  /** Typed at a shell prompt on the normal screen and echoed back: safe to learn from. */
  historyEligible: boolean
  /** Prompt end character (`$`, `#`…) used to recognise the shell returning. */
  promptTerminator: string
}

const PROMPT_SEPARATORS = /[$#%❯➜λ»>] /g
const NOT_A_SHELL_PROMPT = [
  /=[#>]\s*$/, // psql "db=# "
  /^\s*(?:>{1,3}|\.\.\.|\w*>|\w+\s*\[[^\]]*\]>|[\w-]+(?:\s[\w.:-]+)?>)\s*$/, // continuation, python, mysql, redis…
  /^\s*\(\w+\)\s*$/, // (gdb), (Pdb)
]

/**
 * The text in front of a command looks like an interactive shell prompt rather
 * than a password request, REPL, pager or continuation (`> `) prompt.
 */
export function isShellPromptLike(prefix: string): boolean {
  const prompt = (prefix || '').replace(/\s+$/, ' ')
  if (!prompt.trim()) return false
  const terminator = promptTerminator(prompt)
  // oh-my-zsh style themes lead with the symbol: "➜  repo git:(main) ".
  if (!terminator) return /^\s*[➜❯λ]\s/.test(prompt)
  if (NOT_A_SHELL_PROMPT.some((pattern) => pattern.test(prompt))) return false
  // `>` ends Windows prompts ("PS C:\work> "), but also many REPLs.
  if (terminator === '>') return /^(?:PS )?[A-Za-z]:\\[^\n]*>\s*$/.test(prompt)
  return true
}

export function useCommandBuffer(deps: {
  getTerminal: () => Terminal | null
  onCdCommand: (cmd: string) => void
  /** Fired after Enter / paste-with-newline submits a line (may be null if empty). */
  onSubmitted?: (cmd: string | null, info: SubmittedCommandInfo) => void
}) {
  const commandBuffer = ref('')
  const commandBufferDirty = ref(false)
  const capturedSubmitLine = ref('')
  /** Prompt text in front of the cursor when typing of this line began. */
  let promptSnapshot: string | null = null

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

  /**
   * Rows of the logical line around `row`. Long commands wrap onto several
   * screen rows; reading only the cursor row used to record a fragment.
   */
  function logicalLineRows(row: number): { start: number; end: number } | null {
    const buffer = deps.getTerminal()?.buffer?.active
    if (!buffer?.getLine(row)) return null
    let start = row
    while (start > 0 && buffer.getLine(start)?.isWrapped) start--
    let end = row
    while (buffer.getLine(end + 1)?.isWrapped) end++
    return { start, end }
  }

  function readRows(start: number, end: number, lastColumn?: number): string {
    const buffer = deps.getTerminal()?.buffer?.active
    if (!buffer) return ''
    let text = ''
    for (let row = start; row <= end; row++) {
      const line: IBufferLine | undefined = buffer.getLine(row)
      if (!line) break
      const last = row === end
      text += last && lastColumn !== undefined
        ? line.translateToString(false, 0, lastColumn)
        : line.translateToString(last)
    }
    return text
  }

  function getVisibleCommandLine(): string {
    const terminal = deps.getTerminal()
    if (!terminal) return ''
    try {
      const buffer = terminal.buffer?.active
      if (!buffer) return ''
      let row = buffer.baseY + buffer.cursorY
      for (let offset = 0; offset < 5 && row >= 0; offset++) {
        const rows = logicalLineRows(row)
        if (!rows) return ''
        const text = readRows(rows.start, rows.end)
        if (text.trim()) return text
        row = rows.start - 1
      }
      return ''
    } catch {
      return ''
    }
  }

  /** Remember the prompt before the first key of a new command line. */
  function notePromptBeforeInput() {
    if (promptSnapshot !== null || commandBuffer.value || commandBufferDirty.value) return
    try {
      const buffer = deps.getTerminal()?.buffer?.active
      if (!buffer || buffer.type !== 'normal') { promptSnapshot = ''; return }
      const row = buffer.baseY + buffer.cursorY
      const rows = logicalLineRows(row)
      promptSnapshot = rows ? stripShellNotifications(readRows(rows.start, row, buffer.cursorX)) : ''
    } catch {
      promptSnapshot = ''
    }
  }

  function syncAfterTabCompletion(originalInput: string, requireChange = false): boolean {
    const terminal = deps.getTerminal()
    const activeBuffer = terminal?.buffer?.active
    if (!activeBuffer || !originalInput || !commandBuffer.value.startsWith(originalInput)) return false
    const currentLine = getVisibleCommandLine()
    const command = extractCommandFromLine(stripShellNotifications(currentLine))
    if (!command.startsWith(commandBuffer.value)) return false
    if (requireChange && command === commandBuffer.value) return false
    commandBuffer.value = command
    commandBufferDirty.value = false
    return true
  }

  /** Split "prompt + command". Uses the remembered prompt, else the first prompt separator. */
  function splitPromptLine(line: string): { prompt: string; command: string } {
    if (!line.trim()) return { prompt: '', command: '' }
    if (promptSnapshot && line.startsWith(promptSnapshot)) {
      return { prompt: promptSnapshot, command: line.slice(promptSnapshot.length).trim() }
    }
    // The first separator ends the prompt; later ones belong to the command (`echo a > b`).
    for (const match of line.matchAll(PROMPT_SEPARATORS)) {
      const end = (match.index ?? 0) + match[0].length
      const prompt = line.slice(0, end)
      if (isShellPromptLike(prompt)) return { prompt, command: line.slice(end).trim() }
    }
    return { prompt: '', command: line.trim() }
  }

  function extractCommandFromLine(line: string): string {
    return splitPromptLine(line).command
  }

  function extractCommandFromVisibleLine(): string {
    return extractCommandFromLine(stripShellNotifications(getVisibleCommandLine()))
  }

  /** Locate the typed text on the submitted line; the shell echo is the source of truth. */
  function locateTypedCommand(line: string, typed: string): { prompt: string; command: string } | null {
    const trimmed = typed.trim()
    if (!trimmed || !line) return null
    if (promptSnapshot && line.startsWith(promptSnapshot) && line.slice(promptSnapshot.length).trim().startsWith(trimmed.split(/\s+/)[0])) {
      return { prompt: promptSnapshot, command: line.slice(promptSnapshot.length).trim() }
    }
    const index = line.lastIndexOf(trimmed)
    if (index === -1) return null
    return { prompt: line.slice(0, index), command: line.slice(index).trim() }
  }

  function inferSubmittedCommand(command: string): string {
    if (/^\s/.test(command) && command.trim()) return command.trimEnd()
    const visibleLine = stripShellNotifications(getVisibleCommandLine())
    return locateTypedCommand(visibleLine, command)?.command || command.trim()
  }

  function submitBufferedCommand(): string | null {
    const submitLine = stripShellNotifications(capturedSubmitLine.value)
    capturedSubmitLine.value = ''
    const typed = commandBuffer.value
    const dirty = commandBufferDirty.value
    const hadUserInput = dirty || !!typed.trim()
    const terminal = deps.getTerminal()
    const normalScreen = !terminal || terminal.buffer?.active?.type !== 'alternate'

    let cmd = ''
    let prompt = ''
    let echoed = false
    if (hadUserInput) {
      if (!dirty) {
        const found = locateTypedCommand(submitLine, typed) ?? locateTypedCommand(stripShellNotifications(getVisibleCommandLine()), typed)
        if (found) { cmd = found.command; prompt = found.prompt; echoed = true }
        else cmd = typed.trim() // not echoed: password or hidden input
      } else {
        // Tab completion, shell history recall or line editing: trust the screen.
        const split = splitPromptLine(submitLine || stripShellNotifications(getVisibleCommandLine()))
        cmd = split.command
        prompt = split.prompt
        echoed = !!split.command && !!submitLine
      }
    }

    const submittedCommand = cmd || null
    const info: SubmittedCommandInfo = {
      historyEligible: !!submittedCommand
        && echoed
        && normalScreen
        && !/^\s/.test(typed) // leading space: conventional private-history marker
        && isShellPromptLike(prompt),
      promptTerminator: promptTerminator(prompt),
    }

    if (submittedCommand && /(?:^|[;&|]\s*)cd(?:\s|$)/.test(submittedCommand)) {
      setTimeout(() => {
        deps.onCdCommand(submittedCommand)
      }, 50)
    }

    commandBuffer.value = ''
    commandBufferDirty.value = false
    promptSnapshot = null
    pendingSubmitTimer = null

    deps.onSubmitted?.(submittedCommand, info)

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
    promptSnapshot = null
    cancelPendingSubmit()
  }

  return {
    commandBuffer,
    commandBufferDirty,
    capturedSubmitLine,
    submitBufferedCommand,
    stripTerminalSequences,
    getVisibleCommandLine,
    notePromptBeforeInput,
    syncAfterTabCompletion,
    inferSubmittedCommand,
    extractCommandFromLine,
    extractCommandFromVisibleLine,
    scheduleSubmit,
    cancelPendingSubmit,
    resetCommandBuffer,
  }
}
