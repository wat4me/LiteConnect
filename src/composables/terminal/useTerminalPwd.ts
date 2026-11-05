import { splitCommandSegments, tokenizeShellWords } from '@/utils/terminal/shellText'
import { reactive } from 'vue'
import type { PwdState } from '@/domain/terminal/types'

export type { PwdState, TerminalPwdTracker } from '@/domain/terminal/types'

export function useTerminalPwd(deps: { isDirectory: (sessionId: string, path: string) => Promise<boolean> }) {
  const state = reactive<Record<string, PwdState>>({})
  const pendingCdCommands: Record<string, string[]> = {}
  const checks = new Map<string, { tail: Promise<string | null> }>()

  function initSession(sessionId: string, homePath: string, initialPwd?: string) {
    const home = typeof homePath === 'string' ? homePath.trim() : ''
    const initial = typeof initialPwd === 'string' ? initialPwd.trim() : ''
    const existing = state[sessionId]
    const pwd =
      (isAbsolutePosix(existing?.pwd || '') ? existing!.pwd : '') ||
      (isAbsolutePosix(initial) ? initial : '') ||
      (isAbsolutePosix(home) ? home : '')
    if (!pwd) return

    state[sessionId] = {
      pwd: normalizePosixPath(pwd),
      homePath: isAbsolutePosix(home) ? normalizePosixPath(home) : existing?.homePath || '/',
      previousPwd: isAbsolutePosix(existing?.previousPwd || '')
        ? existing!.previousPwd
        : normalizePosixPath(pwd),
      shellReportsPwd: existing?.shellReportsPwd,
    }

    const pending = pendingCdCommands[sessionId]
    if (pending?.length) {
      delete pendingCdCommands[sessionId]
      for (const command of pending) {
        const targets = extractCdTargets(command)
        if (targets.some((target) => target.startsWith('/') || target === '~' || target.startsWith('~'))) {
          void handleCd(sessionId, command)
        }
      }
    }
  }

  async function handleCd(sessionId: string, rawCommand: string): Promise<string | null> {
    if (state[sessionId]?.shellReportsPwd) return getPwd(sessionId)
    const targets = extractCdTargets(rawCommand)
    if (targets.length === 0) return null

    const queue = checks.get(sessionId) ?? { tail: Promise.resolve(null) }
    checks.set(sessionId, queue)
    // Resolve each relative path against the last accepted directory. A failed
    // candidate must never become the base of the next command.
    const task = queue.tail.then(async () => {
      if (checks.get(sessionId) !== queue) return getPwd(sessionId)
      if (!state[sessionId] && !targets.some(target => target.startsWith('/'))) {
        pendingCdCommands[sessionId] = [...(pendingCdCommands[sessionId] || []), rawCommand]
        return null
      }
      for (const target of targets) {
        const path = resolveCdTarget(state[sessionId], target)
        if (!path) continue
        let exists = false
        try {
          exists = await deps.isDirectory(sessionId, path)
        } catch {
          // A closed or inaccessible SFTP channel cannot confirm this guess.
        }
        if (checks.get(sessionId) !== queue) return getPwd(sessionId)
        if (exists) updatePwd(sessionId, path)
      }
      return getPwd(sessionId)
    })
    queue.tail = task
    try {
      return await task
    } finally {
      if (checks.get(sessionId) === queue && queue.tail === task) checks.delete(sessionId)
    }
  }

  async function waitForPendingCd(sessionId: string): Promise<void> {
    await checks.get(sessionId)?.tail
  }

  function getPwd(sessionId: string): string | null {
    return state[sessionId]?.pwd || null
  }

  function getHomePath(sessionId: string): string | null {
    return state[sessionId]?.homePath || null
  }

  function hasSession(sessionId: string): boolean {
    return sessionId in state
  }

  function removeSession(sessionId: string) {
    checks.delete(sessionId)
    delete state[sessionId]
    delete pendingCdCommands[sessionId]
  }

  function updatePwd(sessionId: string, pwd: string) {
    const current = state[sessionId]
    if (current) {
      current.previousPwd = current.pwd
      current.pwd = pwd
    } else {
      state[sessionId] = { pwd, homePath: '', previousPwd: pwd }
    }
  }

  function setPwd(sessionId: string, pwd: string): void {
    if (!isAbsolutePosix(pwd)) return
    checks.delete(sessionId)
    delete pendingCdCommands[sessionId]
    if (state[sessionId]?.pwd !== pwd) updatePwd(sessionId, pwd)
  }

  function reportPwd(sessionId: string, pwd: string): void {
    if (!isAbsolutePosix(pwd)) return
    setPwd(sessionId, pwd)
    state[sessionId].shellReportsPwd = true
  }

  return { state, initSession, handleCd, waitForPendingCd, getPwd, getHomePath, hasSession, removeSession, setPwd, reportPwd }
}

function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/') && !/[\0\r\n]/.test(path)
}

function resolveCdTarget(st: PwdState | undefined, arg: string): string | undefined {
  if (arg.startsWith('/')) return normalizePosixPath(arg)
  if (!st) return
  if (!arg || arg === '~') return st.homePath || undefined
  if (arg === '-') return st.previousPwd
  if (arg.startsWith('~/')) {
    if (st.homePath) return normalizePosixPath(`${st.homePath}/${arg.slice(2)}`)
    return
  }
  // Other tilde forms are shell expansions (for example, ~otheruser).
  if (!arg.startsWith('~')) return normalizePosixPath(`${st.pwd}/${arg}`)
}

function extractCdTargets(rawCommand: string): string[] {
  return splitCommandSegments(rawCommand)
    .map(segment => parseCdTarget(segment))
    .filter((target): target is string => target !== null)
}

function parseCdTarget(segment: string): string | null {
  const tokens = tokenizeShellWords(segment)
  if (tokens[0] !== 'cd') return null

  let targetIndex = 1
  while (targetIndex < tokens.length) {
    const token = tokens[targetIndex]
    if (token === '--') {
      targetIndex++
      break
    }
    if (token === '-' || !token.startsWith('-')) break
    targetIndex++
  }

  return tokens[targetIndex] || ''
}

function normalizePosixPath(path: string): string {
  const parts = path.split('/')
  const result: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      result.pop()
      continue
    }
    result.push(part)
  }
  return '/' + result.join('/')
}
