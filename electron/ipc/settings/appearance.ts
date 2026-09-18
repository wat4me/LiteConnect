import { ipcMain } from 'electron'
import { basename, extname } from 'path'
import { mkdir } from 'fs/promises'
import { t } from '../../i18n'
import { BG_EXTS, mimeForWallpaperExt } from '../../window/appBackgroundProtocol'
import type { SettingsIpcCtx } from './ctx'
import {
  clearWallpaperDir,
  persistWallpaperFromToken,
  putWallpaperPick,
  readImageFileCapped,
} from './wallpaper'

export function registerAppearanceSettingsHandlers(ctx: SettingsIpcCtx): void {
  const { settingsStore, ensureSettingsStoreReady } = ctx

  ipcMain.handle('settings:getAppBackground', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAll().appBackground
  })

  ipcMain.handle('settings:selectAppBackgroundImage', async () => {
    await ensureSettingsStoreReady()
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: t('appBackground.pickTitle'),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const src = result.filePaths[0]
    const ext = extname(src).toLowerCase()
    if (!BG_EXTS.has(ext)) {
      throw new Error(t('appBackground.invalidType'))
    }
    const buf = await readImageFileCapped(src)
    const token = putWallpaperPick(src)
    const imageUrl = `data:${mimeForWallpaperExt(ext)};base64,${buf.toString('base64')}`
    return {
      token,
      fileName: basename(src),
      imageUrl,
    }
  })

  ipcMain.handle(
    'settings:setAppBackgroundImage',
    async (
      _event,
      payload: {
        token?: string
        fit?: 'cover' | 'contain' | 'fill'
        overlay?: number
        clear?: boolean
      },
    ) => {
      await ensureSettingsStoreReady()
      const dir = settingsStore.getAppBackgroundDir()
      if (payload?.clear) {
        await mkdir(dir, { recursive: true })
        await clearWallpaperDir(dir)
        await settingsStore.clearAppBackgroundFile()
        if (payload.fit != null || payload.overlay != null) {
          await settingsStore.setAppBackground({ fit: payload.fit, overlay: payload.overlay })
        }
        return settingsStore.getAll().appBackground
      }
      let fileName = settingsStore.getAppBackground().fileName
      if (payload?.token) {
        fileName = await persistWallpaperFromToken(dir, payload.token)
      }
      await settingsStore.setAppBackground({
        fileName,
        fit: payload?.fit,
        overlay: payload?.overlay,
      })
      return settingsStore.getAll().appBackground
    },
  )

  ipcMain.handle('settings:getFancyCursorEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getFancyCursorEnabled()
  })

  ipcMain.handle('settings:setFancyCursorEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setFancyCursorEnabled(enabled)
  })

  ipcMain.handle('settings:getFancyCursorStyle', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getFancyCursorStyle()
  })

  ipcMain.handle('settings:setFancyCursorStyle', async (_event, style: string) => {
    await ensureSettingsStoreReady()
    if (typeof style !== 'string') {
      throw new Error('Invalid value')
    }
    await settingsStore.setFancyCursorStyle(style)
  })
}
