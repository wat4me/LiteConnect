import { BrowserWindow, ipcMain } from 'electron'
import { CredentialStore } from '../store/credentialStore'
import { SettingsStore } from '../store/settingsStore'
import { createWindow } from '../window/createWindow'
import {
  findDetachedWindow,
  rememberDetachedWindow,
} from '../window/windowRegistry'
import { isValidUUID } from '../utils/validation'

export function registerWindowHandlers(
  credentialStore: CredentialStore,
  settingsStore: SettingsStore,
): void {
  ipcMain.handle('window:openConnection', async (_event, connectionId: string) => {
    await Promise.all([credentialStore.init(), settingsStore.init()])
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    const conn = credentialStore.getConnection(connectionId)
    if (!conn) {
      throw new Error('Connection not found')
    }

    const existing = findDetachedWindow(connectionId)
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return { reused: true, connectionId }
    }

    const theme = settingsStore.getTheme()
    const customColors = theme === 'custom' ? settingsStore.getCustomColors() : null
    const win = createWindow({
      theme,
      customColors,
      primary: false,
      connectionId,
      title: `${conn.name} · LiteConnect`,
    })
    rememberDetachedWindow(connectionId, win)
    return { reused: false, connectionId }
  })

  /** Apply title bar theme to the window that sent the event (multi-window safe). */
  ipcMain.on(
    'titlebar:theme',
    async (event, theme: string, colors?: { color: string; symbolColor: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return

      let finalColors = { color: '#0d1117', symbolColor: '#8b949e' }
      try {
        const { titleBarThemes } = await import('../window/createWindow')
        finalColors = titleBarThemes[theme as keyof typeof titleBarThemes] || titleBarThemes.dark
        if (theme === 'custom' && colors) {
          finalColors = colors
        }
      } catch {
        // keep defaults
      }

      win.setTitleBarOverlay({
        color: finalColors.color,
        symbolColor: finalColors.symbolColor,
      })
      win.setBackgroundColor(finalColors.color)

      try {
        await settingsStore.setTheme(theme)
        if (theme === 'custom' && colors) {
          await settingsStore.setCustomColors({
            fontColor: colors.symbolColor,
            bgColor: colors.color,
          })
        }
      } catch (err) {
        console.error('[Theme] Failed to persist theme:', err)
      }
    },
  )
}
