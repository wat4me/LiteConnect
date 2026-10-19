import { app, shell } from 'electron'
import { mkdirSync, unlinkSync } from 'fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'path'
import { resolveAppIcon, windowAppId } from './appIcon'

/** Only migrate Electron's shortcut when both its AppID and runtime belong to us. */
function ownsLegacyShortcut(shortcut: Electron.ShortcutDetails, appPath: string) {
  const path = relative(resolve(appPath, 'node_modules'), resolve(shortcut.target))
  return shortcut.appUserModelId === windowAppId(false)
    && basename(shortcut.target).toLowerCase() === 'electron.exe'
    && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

export function registerDevelopmentTaskbarShortcut(platform = process.platform): string | null {
  if (platform !== 'win32' || app.isPackaged) return null
  const appPath = app.getAppPath()
  const icon = resolveAppIcon(appPath, process.resourcesPath, false, platform)
  if (!icon) return null
  const directory = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const shortcutPath = join(directory, 'LiteConnect Dev.lnk')
  const legacyPath = join(directory, 'Electron.lnk')
  const details: Electron.ShortcutDetails = {
    target: process.execPath, args: `"${appPath}"`, cwd: appPath,
    icon, iconIndex: 0, appUserModelId: windowAppId(false),
    description: 'LiteConnect development workspace',
  }
  try {
    let current: Electron.ShortcutDetails | undefined
    try { current = shell.readShortcutLink(shortcutPath) } catch { /* First launch. */ }
    if (!current || !Object.entries(details).every(([key, value]) => current?.[key as keyof Electron.ShortcutDetails] === value)) {
      mkdirSync(directory, { recursive: true })
      if (!shell.writeShortcutLink(shortcutPath, 'create', details)) {
        console.warn('[Dev Taskbar] Failed to register development shortcut')
        return null
      }
    }
    // A second shortcut with the same AppID can make Shell choose Electron's
    // name and icon even though BrowserWindow and setAppDetails are correct.
    let legacy: Electron.ShortcutDetails | undefined
    try { legacy = shell.readShortcutLink(legacyPath) } catch { /* Nothing to migrate. */ }
    if (legacy && ownsLegacyShortcut(legacy, appPath)) unlinkSync(legacyPath)
    return shortcutPath
  } catch (error) {
    console.warn('[Dev Taskbar] Failed to register development shortcut:', error)
    return null
  }
}
