import type { Terminal } from '@xterm/xterm'

interface PwdQuery {
  startMarker: string
  endMarker: string
  buffer: string
  started: boolean
  timer: ReturnType<typeof setTimeout>
  /** Uncommitted shell line captured before we Ctrl+U for the probe. */
  pendingInput: string
  resolve: (pwd: string) => void
  reject: (error: Error) => void
}

interface PwdOutputSuppression {
  startMarker: string
  endMarker: string
  buffer: string
  started: boolean
  timer: ReturnType<typeof setTimeout>
}

/** Longest suffix of `text` that is a prefix of `marker` (for cross-chunk marker match). */
function markerPrefixHoldback(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1)
  for (let n = max; n > 0; n--) {
    if (marker.startsWith(text.slice(-n))) return n
  }
  return 0
}

/**
 * Local-only erase of draft text already painted by remote echo.
 * Used when we hide remote Ctrl+U / probe echo so the user does not see ghost input.
 */
function localEraseDraft(term: Terminal, pending: string) {
  if (!pending) return
  // Readline-style rubout: BS + space + BS per code point (good for ASCII; OK for most drafts).
  let erase = ''
  for (const _ch of pending) {
    erase += '\b \b'
  }
  term.write(erase)
}

export function useTerminalPwdQuery(deps: {
  getTerminal: () => Terminal | null
  flushRenderBatch: (callback?: () => void) => void
  writeToSsh: (data: string) => void
  onPwdOutput: (pwd: string) => void
  /** Local command-line tracker: text the user typed but has not submitted. */
  getPendingInput?: () => string
  /** Called when we clear the remote line for a pwd probe (reset local buffer). */
  onLineClearedForPwd?: () => void
  /** After a successful probe, restore the pending line into the local tracker. */
  onRestorePendingInput?: (text: string) => void
}) {
  let pwdQuery: PwdQuery | null = null
  let pwdOutputSuppression: PwdOutputSuppression | null = null
  let pwdQueryDrainTimer: ReturnType<typeof setTimeout> | null = null

  function stripTerminalSequences(text: string): string {
    return text
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
      .replace(/\r/g, '\n')
  }

  function extractPwdFromQueryOutput(output: string): string | null {
    const lines = stripTerminalSequences(output)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]
      if (line.startsWith('/')) return line
    }
    return null
  }

  function clearPwdQuery() {
    if (!pwdQuery) return
    clearTimeout(pwdQuery.timer)
    pwdQuery = null
  }

  function clearPwdOutputSuppression() {
    if (!pwdOutputSuppression) return
    clearTimeout(pwdOutputSuppression.timer)
    pwdOutputSuppression = null
  }

  function suppressLatePwdOutput(query: { startMarker: string; endMarker: string }, timeoutMs = 5000) {
    clearPwdOutputSuppression()
    const timer = setTimeout(() => {
      pwdOutputSuppression = null
    }, timeoutMs)
    pwdOutputSuppression = {
      startMarker: query.startMarker,
      endMarker: query.endMarker,
      buffer: '',
      started: false,
      timer,
    }
  }

  function startPwdQueryDrain() {
    if (pwdQueryDrainTimer) clearTimeout(pwdQueryDrainTimer)
    // Brief quiet window so trailing probe echo after END does not paint.
    pwdQueryDrainTimer = setTimeout(() => {
      pwdQueryDrainTimer = null
    }, 40)
  }

  function restorePendingInput(pending: string) {
    if (!pending) return
    // After probe END + short drain, retype the draft line (no CR).
    setTimeout(() => {
      if (!deps.getTerminal()) return
      if (pwdQueryDrainTimer) {
        clearTimeout(pwdQueryDrainTimer)
        pwdQueryDrainTimer = null
      }
      deps.writeToSsh(pending)
      deps.onRestorePendingInput?.(pending)
    }, 50)
  }

  function finishPwdQuery(output: string) {
    const query = pwdQuery
    if (!query) return

    const pwd = extractPwdFromQueryOutput(output)
    const pending = query.pendingInput
    clearPwdQuery()
    startPwdQueryDrain()

    if (!pwd) {
      restorePendingInput(pending)
      query.reject(new Error('Unable to read terminal pwd'))
      return
    }

    deps.onPwdOutput(pwd)
    query.resolve(pwd)
    restorePendingInput(pending)
  }

  /**
   * Hide the interactive pwd probe:
   * - Before START: suppress everything (probe command echo + Ctrl+U erase).
   *   Draft text is cleared locally when the probe is sent, so this does not leave ghosts.
   * - Between START and END: suppress probe body (markers + pwd).
   * - After END: pass through (new shell prompt, etc.).
   */
  function filterMarkedSegment(
    state: { startMarker: string; endMarker: string; buffer: string; started: boolean },
    data: string,
    onComplete: (inner: string) => void,
  ): string {
    state.buffer += data

    if (!state.started) {
      const startIndex = state.buffer.indexOf(state.startMarker)
      if (startIndex === -1) {
        // Keep only a possible partial START prefix; drop the rest (command echo).
        const hold = markerPrefixHoldback(state.buffer, state.startMarker)
        state.buffer = hold > 0 ? state.buffer.slice(-hold) : ''
        return ''
      }
      // Drop command echo / erase before START entirely.
      state.started = true
      state.buffer = state.buffer.slice(startIndex + state.startMarker.length)
    }

    const endIndex = state.buffer.indexOf(state.endMarker)
    if (endIndex === -1) {
      // Keep entire body buffered (may include partial END); never paint probe body.
      const hold = markerPrefixHoldback(state.buffer, state.endMarker)
      // If we only hold a short prefix, still do not emit body before it.
      void hold
      return ''
    }

    const inner = state.buffer.slice(0, endIndex)
    const after = state.buffer.slice(endIndex + state.endMarker.length)
    state.buffer = ''
    onComplete(inner)
    // Prompt / user output after END is visible.
    return after
  }

  function processSuppressedPwdOutput(data: string): string {
    const suppression = pwdOutputSuppression
    if (!suppression) return data

    return filterMarkedSegment(suppression, data, () => {
      clearPwdOutputSuppression()
      startPwdQueryDrain()
    })
  }

  function processPwdQueryData(data: string): string {
    if (pwdQueryDrainTimer) return ''
    const query = pwdQuery
    if (!query) return processSuppressedPwdOutput(data)

    return filterMarkedSegment(query, data, (inner) => {
      finishPwdQuery(inner)
    })
  }

  function requestInteractivePwd(): Promise<string> {
    if (!deps.getTerminal()) return Promise.reject(new Error('Terminal is not ready'))

    clearPwdOutputSuppression()
    if (pwdQuery) {
      const previous = pwdQuery
      clearPwdQuery()
      suppressLatePwdOutput(previous)
      // Do not restore previous.pending here — a newer probe supersedes it.
      previous.reject(new Error('Superseded by a new pwd request'))
    }

    const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const startMarker = `__LITECONNECT_PWD_${token}_START__`
    const endMarker = `__LITECONNECT_PWD_${token}_END__`
    const pendingInput = (deps.getPendingInput?.() || '').replace(/[\r\n]+/g, '')

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const query = pwdQuery
        if (!query) return
        const pending = query.pendingInput
        clearPwdQuery()
        // Keep hiding late probe output; never paint buffered command echo.
        suppressLatePwdOutput(query)
        restorePendingInput(pending)
        reject(new Error('Terminal pwd request timeout'))
      }, 5000)

      pwdQuery = {
        startMarker,
        endMarker,
        buffer: '',
        started: false,
        timer,
        pendingInput,
        resolve,
        reject,
      }

      // Ctrl+U clears remote readline so draft input is not glued onto the probe.
      // Local erase removes already-painted draft (remote erase is hidden with probe echo).
      const command =
        `\x15` +
        `_lssh_a=__LITECONNECT_; _lssh_b=PWD_${token}_; ` +
        `printf '\\n%s%sSTART__\\n' "$_lssh_a" "$_lssh_b"; ` +
        `pwd; ` +
        `printf '\\n%s%sEND__\\n' "$_lssh_a" "$_lssh_b"; ` +
        `unset _lssh_a _lssh_b\r`

      deps.onLineClearedForPwd?.()
      deps.flushRenderBatch(() => {
        const term = deps.getTerminal()
        if (term && pendingInput) {
          localEraseDraft(term, pendingInput)
        }
        deps.writeToSsh(command)
      })
    })
  }

  function dispose() {
    if (pwdQuery) {
      const query = pwdQuery
      clearPwdQuery()
      suppressLatePwdOutput(query)
      query.reject(new Error('Terminal disposed'))
    }
    clearPwdOutputSuppression()
    if (pwdQueryDrainTimer) {
      clearTimeout(pwdQueryDrainTimer)
      pwdQueryDrainTimer = null
    }
  }

  return {
    pwdQuery,
    pwdOutputSuppression,
    pwdQueryDrainTimer,
    processPwdQueryData,
    extractPwdFromQueryOutput,
    startPwdQueryDrain,
    clearPwdQuery,
    clearPwdOutputSuppression,
    suppressLatePwdOutput,
    finishPwdQuery,
    requestInteractivePwd,
    dispose,
  }
}
