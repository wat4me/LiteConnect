import { reactive } from 'vue'
import type { PwdState } from '@/domain/terminal/types'

export type { PwdState, TerminalPwdTracker } from '@/domain/terminal/types'

export function useTerminalPwd() {
  const state = reactive<Record<string, PwdState>>({})
  const pendingCdCommands: Record<string, string[]> = {}

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
    }

    const pending = pendingCdCommands[sessionId]
    if (pending?.length) {
      delete pendingCdCommands[sessionId]
      for (const command of pending) {
        const targets = extractCdTargets(command)
        if (targets.some((target) => target.startsWith('/') || target === '~' || target.startsWith('~'))) {
          handleCd(sessionId, command)
        }
      }
    }
  }

  function handleCd(sessionId: string, rawCommand: string): string | null {
    const targets = extractCdTargets(rawCommand)
    if (targets.length === 0) return null

    const st = state[sessionId]
    if (!st) {
      const absoluteIndex = targets.findIndex(target => target.startsWith('/'))
      if (absoluteIndex !== -1) {
        const newPwd = normalizePosixPath(targets[absoluteIndex])
        state[sessionId] = { pwd: newPwd, homePath: '/', previousPwd: newPwd }
        for (const target of targets.slice(absoluteIndex + 1)) {
          applyCdTarget(state[sessionId], target)
        }
        return state[sessionId].pwd
      }

      pendingCdCommands[sessionId] = [...(pendingCdCommands[sessionId] || []), rawCommand]
      return null
    }

    for (const target of targets) {
      applyCdTarget(st, target)
    }
    return st.pwd
  }

  function revertCd(sessionId: string): string | null {
    const st = state[sessionId]
    if (!st) return null
    if (st.pwd !== st.previousPwd) {
      st.pwd = st.previousPwd
      return st.pwd
    }
    const parent = parentPosixPath(st.pwd)
    if (parent === st.pwd) return st.pwd
    st.pwd = parent
    st.previousPwd = parent
    return st.pwd
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
    delete state[sessionId]
    delete pendingCdCommands[sessionId]
  }

  function setPwd(sessionId: string, pwd: string): void {
    const st = state[sessionId]
    if (st) {
      st.pwd = pwd
    }
  }

  return { state, initSession, handleCd, revertCd, getPwd, getHomePath, hasSession, removeSession, setPwd }
}

function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/') && !/[\0\r\n]/.test(path)
}

function parentPosixPath(path: string): string {
  if (!isAbsolutePosix(path) || path === '/') return '/'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

function applyCdTarget(st: PwdState, arg: string): void {
  if (!arg || arg === '~') {
    if (!isAbsolutePosix(st.homePath)) return
    st.previousPwd = st.pwd || st.homePath
    st.pwd = st.homePath
    return
  }

  if (arg === '-') {
    const prev = st.previousPwd
    st.previousPwd = st.pwd
    st.pwd = prev
    return
  }

  if (!arg.startsWith('/') && !arg.startsWith('~') && !isAbsolutePosix(st.pwd)) {
    // Relative cd with no known base would invent `/v/...` from an empty tracker.
    return
  }

  const newPwd = arg.startsWith('/')
    ? normalizePosixPath(arg)
    : arg.startsWith('~')
      ? normalizePosixPath(st.homePath + '/' + arg.slice(1))
      : normalizePosixPath(st.pwd + '/' + arg)

  st.previousPwd = st.pwd
  st.pwd = newPwd
}

function extractCdTargets(rawCommand: string): string[] {
  return splitCommandSegments(rawCommand)
    .map(segment => parseCdTarget(segment))
    .filter((target): target is string => target !== null)
}

function splitCommandSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < command.length; index++) {
    const char = command[index]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'") {
      current += char
      quote = char
      continue
    }

    const next = command[index + 1]
    if (char === ';' || (char === '&' && next === '&') || (char === '|' && next === '|')) {
      if (current.trim()) segments.push(current.trim())
      current = ''
      if (char !== ';') index++
      continue
    }

    current += char
  }

  if (current.trim()) segments.push(current.trim())
  return segments
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

function tokenizeShellWords(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of segment) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) tokens.push(current)
  return tokens
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
