import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { getPrimaryWindow } from '../window/windowRegistry'
import { safeWebContentsSend } from '../utils/validation'

const CONNECT_TIMEOUT_MS = 180_000

type Pending = {
  resolve: (sessionId: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, Pending>()

function targetWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  return getPrimaryWindow()
}

export function requestRendererConnect(connectionId: string): Promise<string> {
  const win = targetWindow()
  if (!win || win.isDestroyed()) {
    return Promise.reject(new Error('CONNECT_UNAVAILABLE'))
  }
  const requestId = uuidv4()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('CONNECT_TIMEOUT'))
    }, CONNECT_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
    safeWebContentsSend(win.webContents, 'mcp:connectRequest', { requestId, connectionId })
  })
}

export function completeRendererConnect(
  requestId: string,
  result: { sessionId?: string; error?: string },
): boolean {
  const item = pending.get(requestId)
  if (!item) return false
  clearTimeout(item.timer)
  pending.delete(requestId)
  if (result.sessionId) item.resolve(result.sessionId)
  else item.reject(new Error(result.error || 'CONNECT_FAILED'))
  return true
}
