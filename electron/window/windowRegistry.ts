import type { BrowserWindow } from 'electron'
import { safeSend } from '../utils/validation'

/** All live app windows (main + detached session windows). */
const windows = new Set<BrowserWindow>()

/** Primary window (first created / main shell). May be null after close. */
let primaryWindow: BrowserWindow | null = null

/** sessionId → owning webContents.id (for multi-window cleanup). */
const sessionOwners = new Map<string, number>()

/** Detached windows keyed by connectionId (reuse / focus). */
const detachedByConnection = new Map<string, BrowserWindow>()

export function registerWindow(win: BrowserWindow, opts?: { primary?: boolean }): void {
  windows.add(win)
  if (opts?.primary || !primaryWindow || primaryWindow.isDestroyed()) {
    primaryWindow = win
  }
  win.on('closed', () => {
    windows.delete(win)
    if (primaryWindow === win) {
      primaryWindow = [...windows].find((w) => !w.isDestroyed()) || null
    }
    for (const [connId, w] of detachedByConnection) {
      if (w === win) detachedByConnection.delete(connId)
    }
  })
}

export function getPrimaryWindow(): BrowserWindow | null {
  if (primaryWindow && !primaryWindow.isDestroyed()) return primaryWindow
  primaryWindow = [...windows].find((w) => !w.isDestroyed()) || null
  return primaryWindow
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

export function setSessionOwner(sessionId: string, webContentsId: number): void {
  if (!sessionId) return
  sessionOwners.set(sessionId, webContentsId)
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
