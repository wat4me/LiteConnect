import { app, globalShortcut, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { SettingsStore } from '../store/settingsStore'
import { DEFAULT_GLOBAL_HOTKEY } from '../../shared/globalHotkey'
import { t } from '../i18n'

/** Default accelerator; the user can override it in settings → app. */
export const TOGGLE_WINDOW_ACCELERATOR = DEFAULT_GLOBAL_HOTKEY

let tray: Tray | null = null
let quitting = false
/** Accelerator this app currently owns, so changes can unregister the old combo. */
let registeredAccelerator: string | null = null
/** Avoid installing duplicate close handlers if tray setup is called again. */
const closeHandlerWindows = new WeakSet<BrowserWindow>()

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

function toggleWindowVisibility(): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win && win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    showMainWindow()
  }
}

/** Tell renderers so settings can warn that another app owns the combo. */
function notifyHotkeyFailed(accelerator: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:globalHotkeyFailed', accelerator)
  }
}

function syncGlobalHotkey(settingsStore: SettingsStore): void {
  const wanted = settingsStore.getGlobalHotkeyEnabled() ? settingsStore.getGlobalHotkey() : null
  if (wanted === registeredAccelerator) return

  if (registeredAccelerator && globalShortcut.isRegistered(registeredAccelerator)) {
    globalShortcut.unregister(registeredAccelerator)
  }
  registeredAccelerator = null
  if (!wanted) return

  try {
    const ok = globalShortcut.register(wanted, toggleWindowVisibility)
    if (!ok) {
      notifyHotkeyFailed(wanted)
      return
    }
    registeredAccelerator = wanted
  } catch (err) {
    console.error('[Tray] register hotkey failed:', err)
    notifyHotkeyFailed(wanted)
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

  const installWindowHandler = (win: BrowserWindow) => {
    if (closeHandlerWindows.has(win)) return
    closeHandlerWindows.add(win)
    win.on('close', (e) => {
      if (quitting || win.isDestroyed()) return
      if (!settingsStore.getCloseToTrayEnabled()) return
      e.preventDefault()
      win.hide()
    })
  }

  // The first BrowserWindow may already exist by the time settings finish
  // loading. Cover it as well as detached / DB windows created afterwards.
  for (const win of BrowserWindow.getAllWindows()) installWindowHandler(win)
  app.on('browser-window-created', (_e, win) => installWindowHandler(win))
}
