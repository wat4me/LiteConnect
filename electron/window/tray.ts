import { app, globalShortcut, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'

export const TOGGLE_WINDOW_ACCELERATOR = 'Alt+Shift+L'

let tray: Tray | null = null
let quitting = false

function trayIconPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'LiteConnect.png')]
    : [join(process.cwd(), 'build', 'LiteConnect.png')]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function showMainWindow() {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
  if (!win) {
    openMainWindowFallback()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

let openMainWindowFallback: () => void = () => {}

/** Mark quit intent so close-to-tray does not swallow the final close. */
export function markQuitting(): void {
  quitting = true
}

function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

function syncGlobalHotkey(settingsStore: SettingsStore): void {
  const wanted = settingsStore.getGlobalHotkeyEnabled()
  const registered = globalShortcut.isRegistered(TOGGLE_WINDOW_ACCELERATOR)
  if (wanted && !registered) {
    try {
      globalShortcut.register(TOGGLE_WINDOW_ACCELERATOR, () => {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win && win.isVisible() && win.isFocused()) {
          win.hide()
        } else {
          showMainWindow()
        }
      })
    } catch (err) {
      console.error('[Tray] register hotkey failed:', err)
    }
  } else if (!wanted && registered) {
    globalShortcut.unregister(TOGGLE_WINDOW_ACCELERATOR)
  }
}

function syncTrayIcon(settingsStore: SettingsStore): void {
  const wanted = settingsStore.getCloseToTrayEnabled()
  if (wanted && !tray) {
    const iconPath = trayIconPath()
    const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    tray = new Tray(image)
    tray.setToolTip('LiteConnect')
    rebuildTrayMenu()
    tray.on('click', () => showMainWindow())
  } else if (!wanted && tray) {
    destroyTray()
  }
}

function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: t('tray.showWindow'),
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: t('tray.quit'),
        click: () => {
          markQuitting()
          app.quit()
        },
      },
    ]),
  )
}

/** Re-read tray / hotkey related settings and apply the diff. */
export function syncTrayFromSettings(settingsStore: SettingsStore): void {
  syncTrayIcon(settingsStore)
  syncGlobalHotkey(settingsStore)
}

/**
 * Install close-to-tray behavior on every browser window. Windows are hidden
 * instead of closed while the setting is on; a real quit bypasses it.
 */
export function installCloseToTray(
  settingsStore: SettingsStore,
  reopenMainWindow: () => void,
): void {
  openMainWindowFallback = reopenMainWindow
  app.on('browser-window-created', (_e, win) => {
    win.on('close', (e) => {
      if (quitting || win.isDestroyed()) return
      if (!settingsStore.getCloseToTrayEnabled()) return
      e.preventDefault()
      win.hide()
    })
  })
}
