/**
 * Renderer-wide notifications delivered through `window`.
 *
 * Every event name and payload is declared here once. Emitters and listeners use
 * the typed helpers below instead of string literals with `CustomEvent` casts.
 */

export type TransferFinishedStatus = 'completed' | 'error' | 'skipped' | 'partial' | 'cancelled'
export type TransferEventDirection = 'download' | 'upload'

export interface TerminalPwdRequestDetail {
  sessionId: string
  /** Set by the terminal that owns the session; an unhandled request is rejected by the sender. */
  handled?: boolean
  resolve: (pwd: string) => void
  reject: (error: Error) => void
}

export interface AppEventMap {
  // Settings applied in this window (committed values or live previews).
  'app-background-settings-change': { imageUrl?: string; dataUrl?: string; fit?: string; overlay?: number }
  'fancy-cursor-settings-change': { enabled?: boolean; style?: string }
  'download-conflict-settings-change': { strategy?: string }
  'sftp-font-settings-change': { fontSize?: number }
  'terminal-font-settings-change': { fontSize?: number; fontFamily?: string }
  'terminal-palette-change': { palette?: string }
  'terminal-behavior-settings-change': {
    scrollback?: number
    pasteConfirmEnabled?: boolean
    pasteConfirmMaxChars?: number
    commandSuggestEnabled?: boolean
    localEchoEnabled?: boolean
  }
  'latency-settings-change': { enabled?: boolean; intervalMs?: number }
  'connection-usage-stats-settings-change': { enabled?: boolean }
  'workspace-restore-settings-change': { enabled?: boolean }
  'monitor-settings-change': { enabled?: boolean; intervalMs?: number }

  // Stores changed outside the component that displays them.
  'connections-store-change': void
  'command-snippets-change': void
  'shell-command-history-cleared': void

  // Terminal ↔ SFTP and session notifications.
  'request-terminal-pwd': TerminalPwdRequestDetail
  'sftp-pause-follow': { sessionId: string; reason?: 'container' }
  'ssh-reconnect-failed': { sessionId: string; message?: string; nonRetryable?: boolean }

  // Completion notifications consumed by the app-level toasts and the file browser.
  'sftp-upload-complete': { sessionId: string }
  'sftp-transfer-finished': {
    sessionId: string
    transferId: string
    fileName: string
    direction: TransferEventDirection
    status: TransferFinishedStatus
    error?: string
    completedFiles?: number
    failedFiles?: number
    totalFiles?: number
  }
  'sftp-batch-transfer-finished': {
    batchId?: string
    sessionId: string
    direction: TransferEventDirection
    success: number
    error: number
    skipped: number
    partial: number
    cancelled: number
    total: number
  }
  'batch-command-finished': {
    command: string
    success: number
    error: number
    cancelled: number
    total: number
    cancelledByUser?: boolean
  }
}

export type AppEventName = keyof AppEventMap
export type AppEvent<K extends AppEventName> = CustomEvent<AppEventMap[K]>
export type AppEventListener<K extends AppEventName> = (event: AppEvent<K>) => void

type AppEventArgs<K extends AppEventName> = AppEventMap[K] extends void ? [] : [detail: AppEventMap[K]]

function defaultTarget(): EventTarget {
  return typeof window !== 'undefined' ? window : globalThis
}

export function emitAppEvent<K extends AppEventName>(name: K, ...args: AppEventArgs<K>): void {
  defaultTarget().dispatchEvent(new CustomEvent(name, { detail: args[0] }))
}

/** Returns a function that removes the listener. */
export function addAppEventListener<K extends AppEventName>(
  name: K,
  listener: AppEventListener<K>,
  target: EventTarget = defaultTarget(),
): () => void {
  target.addEventListener(name, listener as EventListener)
  return () => target.removeEventListener(name, listener as EventListener)
}

export function removeAppEventListener<K extends AppEventName>(
  name: K,
  listener: AppEventListener<K>,
  target: EventTarget = defaultTarget(),
): void {
  target.removeEventListener(name, listener as EventListener)
}
