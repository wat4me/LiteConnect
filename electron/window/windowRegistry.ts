import type { BrowserWindow } from 'electron'
import { safeSend } from '../utils/validation'

/** All live app windows (main + detached session windows). */
const windows = new Set<BrowserWindow>()

/** Actual main shell window; unlike primaryWindow, never falls back to a detached window. */
let mainShellWindow: BrowserWindow | null = null

/** Primary window (first created / main shell). May be null after close. */
let primaryWindow: BrowserWindow | null = null

/** Dedicated database-module window (at most one). Never becomes primary. */
let dbWindow: BrowserWindow | null = null

/** sessionId → owning webContents.id (for multi-window cleanup). */
const sessionOwners = new Map<string, number>()

/** Detached windows keyed by connectionId (reuse / focus). */
const detachedByConnection = new Map<string, BrowserWindow>()

export function registerWindow(win: BrowserWindow, opts?: { primary?: boolean; db?: boolean }): void {
  windows.add(win)
  if (opts?.primary) mainShellWindow = win
  if (opts?.db) dbWindow = win
  if (!opts?.db && (opts?.primary || !primaryWindow || primaryWindow.isDestroyed())) {
    primaryWindow = win
  }
  win.on('closed', () => {
    windows.delete(win)
    if (mainShellWindow === win) mainShellWindow = null
    if (dbWindow === win) dbWindow = null
    if (primaryWindow === win) {
      primaryWindow = [...windows].find((w) => !w.isDestroyed() && w !== dbWindow) || null
    }
    for (const [connId, w] of detachedByConnection) {
      if (w === win) detachedByConnection.delete(connId)
    }
  })
}

export function getMainShellWindow(): BrowserWindow | null {
  if (mainShellWindow && !mainShellWindow.isDestroyed()) return mainShellWindow
  mainShellWindow = null
  return null
}

export function getPrimaryWindow(): BrowserWindow | null {
  if (primaryWindow && !primaryWindow.isDestroyed()) return primaryWindow
  primaryWindow = [...windows].find((w) => !w.isDestroyed() && w !== dbWindow) || null
  return primaryWindow
}

/** The dedicated DB window, if it is alive. */
export function getDbWindow(): BrowserWindow | null {
  if (dbWindow && !dbWindow.isDestroyed()) return dbWindow
  dbWindow = null
  return null
}

export function getAllWindows(): BrowserWindow[] {
  return [...windows].filter((w) => !w.isDestroyed())
}

/** Send to every live window (SSH data, host-key dialogs, etc.). */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of getAllWindows()) {
    safeSend(win, channel, ...args)
  }
}

const sessionOwnedListeners = new Set<(sessionId: string, webContentsId: number) => void>()

export function setSessionOwner(sessionId: string, webContentsId: number): void {
  if (!sessionId) return
  sessionOwners.set(sessionId, webContentsId)
  for (const listener of sessionOwnedListeners) {
    try { listener(sessionId, webContentsId) } catch (error) { console.warn('[Window Registry] session listener failed:', error) }
  }
}

export function getSessionOwner(sessionId: string): number | undefined {
  return sessionOwners.get(sessionId)
}

/** Fires when a window takes ownership of a connected session (connect, reconnect, adopt). */
export function onSessionOwned(listener: (sessionId: string, webContentsId: number) => void): () => void {
  sessionOwnedListeners.add(listener)
  return () => { sessionOwnedListeners.delete(listener) }
}

export function clearSessionOwner(sessionId: string): void {
  sessionOwners.delete(sessionId)
}

export function getSessionsOwnedBy(webContentsId: number): string[] {
  const ids: string[] = []
  for (const [sessionId, owner] of sessionOwners) {
    if (owner === webContentsId) ids.push(sessionId)
  }
  return ids
}

export function clearOwnersForWebContents(webContentsId: number): string[] {
  const owned = getSessionsOwnedBy(webContentsId)
  for (const id of owned) sessionOwners.delete(id)
  return owned
}

export function rememberDetachedWindow(connectionId: string, win: BrowserWindow): void {
  detachedByConnection.set(connectionId, win)
  win.on('closed', () => {
    if (detachedByConnection.get(connectionId) === win) {
      detachedByConnection.delete(connectionId)
    }
  })
}

export function findDetachedWindow(connectionId: string): BrowserWindow | null {
  const win = detachedByConnection.get(connectionId)
  if (!win || win.isDestroyed()) {
    detachedByConnection.delete(connectionId)
    return null
  }
  return win
}

export function getWindowRole(win: BrowserWindow): 'main' | 'database' | 'detached' {
  if (getDbWindow() === win) return 'database'
  for (const detached of detachedByConnection.values()) {
    if (detached === win) return 'detached'
  }
  return 'main'
}
