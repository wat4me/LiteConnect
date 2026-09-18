import { Notification, type BrowserWindow } from 'electron'
import { t } from '../i18n'
import { safeSend } from '../utils/validation'

export type AiApprovalNotificationInput = {
  sessionId: string
  toolName: string
}

function isWindowActivelyVisible(win: BrowserWindow): boolean {
  return win.isVisible() && !win.isMinimized() && win.isFocused()
}

/**
 * Show a privacy-safe OS notification only when the owning app window is not
 * already in front of the user. Returns a cleanup callback for approval finish.
 */
export function showAiApprovalNotification(
  win: BrowserWindow | null,
  input: AiApprovalNotificationInput,
): (() => void) | undefined {
  if (!win || win.isDestroyed() || isWindowActivelyVisible(win)) return undefined
  if (!Notification.isSupported()) return undefined

  const notification = new Notification({
    title: t('ai.approvalNotificationTitle'),
    body: t('ai.approvalNotificationBody', { tool: input.toolName || 'AI 工具' }),
    silent: false,
  })

  notification.on('click', () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    safeSend(win, 'ai:approvalNotificationClick', input.sessionId)
  })

  try {
    notification.show()
  } catch (err) {
    console.warn('[AI Approval Notification]', err)
    return undefined
  }

  return () => {
    try {
      notification.close()
    } catch {}
  }
}
