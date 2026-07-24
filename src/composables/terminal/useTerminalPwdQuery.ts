import type { Terminal } from '@xterm/xterm'

interface PwdQuery {
  startMarker: string
  endMarker: string
  buffer: string
  started: boolean
  timer: ReturnType<typeof setTimeout>
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

export function useTerminalPwdQuery(deps: {
  getTerminal: () => Terminal | null
  flushRenderBatch: (callback?: () => void) => void
  writeToSsh: (data: string) => void
  onPwdOutput: (pwd: string) => void
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
    pwdQueryDrainTimer = setTimeout(() => {
      pwdQueryDrainTimer = null
    }, 120)
  }

  function finishPwdQuery(output: string) {
    const query = pwdQuery
    if (!query) return

    const pwd = extractPwdFromQueryOutput(output)
    clearPwdQuery()
    startPwdQueryDrain()

    if (!pwd) {
      query.reject(new Error('Unable to read terminal pwd'))
      return
    }

    deps.onPwdOutput(pwd)
    query.resolve(pwd)
  }

  function processSuppressedPwdOutput(data: string): string {
    const suppression = pwdOutputSuppression
    if (!suppression) return data

    suppression.buffer += data

    if (!suppression.started) {
      const startIndex = suppression.buffer.indexOf(suppression.startMarker)
      if (startIndex === -1) return ''
      suppression.started = true
      suppression.buffer = suppression.buffer.slice(startIndex + suppression.startMarker.length)
    }

    const endIndex = suppression.buffer.indexOf(suppression.endMarker)
    if (endIndex === -1) return ''

    clearPwdOutputSuppression()
    startPwdQueryDrain()
    return ''
  }

  function processPwdQueryData(data: string): string {
    if (pwdQueryDrainTimer) return ''
    const query = pwdQuery
    if (!query) return processSuppressedPwdOutput(data)

    query.buffer += data

    if (!query.started) {
      const startIndex = query.buffer.indexOf(query.startMarker)
      if (startIndex === -1) return ''
      query.started = true
      query.buffer = query.buffer.slice(startIndex + query.startMarker.length)
    }

    const endIndex = query.buffer.indexOf(query.endMarker)
    if (endIndex === -1) return ''

    finishPwdQuery(query.buffer.slice(0, endIndex))
    return ''
  }

  function requestInteractivePwd(): Promise<string> {
    if (!deps.getTerminal()) return Promise.reject(new Error('Terminal is not ready'))

    clearPwdOutputSuppression()
    if (pwdQuery) {
      const previous = pwdQuery
      clearPwdQuery()
      suppressLatePwdOutput(previous)
      previous.reject(new Error('Superseded by a new pwd request'))
    }

    const token = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const startMarker = `__LITECONNECT_PWD_${token}_START__`
    const endMarker = `__LITECONNECT_PWD_${token}_END__`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const query = pwdQuery
        if (!query) return
        clearPwdQuery()
        suppressLatePwdOutput(query)
        reject(new Error('Terminal pwd request timeout'))
      }, 5000)

      pwdQuery = {
        startMarker,
        endMarker,
        buffer: '',
        started: false,
        timer,
        resolve,
        reject,
      }

      const command =
        `_lssh_a=__LITECONNECT_; _lssh_b=PWD_${token}_; ` +
        `printf '\\n%s%sSTART__\\n' "$_lssh_a" "$_lssh_b"; ` +
        `pwd; ` +
        `printf '\\n%s%sEND__\\n' "$_lssh_a" "$_lssh_b"; ` +
        `unset _lssh_a _lssh_b\r`

      deps.flushRenderBatch(() => {
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