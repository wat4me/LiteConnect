import { ipcMain } from 'electron'
import { SettingsStore } from '../../store/settingsStore'
import type { SettingsIpcCtx } from './ctx'

export function registerTerminalSettingsHandlers(ctx: SettingsIpcCtx): void {
  const { settingsStore, ensureSettingsStoreReady } = ctx

  ipcMain.handle('settings:getTerminalFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontSize()
  })

  ipcMain.handle('settings:getTerminalFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontFamily()
  })

  ipcMain.handle('settings:setTerminalFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalFontFamily(family)
  })

  ipcMain.handle('settings:getTerminalPalette', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPalette()
  })

  ipcMain.handle('settings:setTerminalPalette', async (_event, palette: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPalette(palette)
  })

  ipcMain.handle('settings:getTerminalScrollback', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalScrollback()
  })

  ipcMain.handle('settings:setTerminalScrollback', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid scrollback')
    await settingsStore.setTerminalScrollback(n)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmEnabled()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPasteConfirmEnabled(!!enabled)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmMaxChars', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmMaxChars()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmMaxChars', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid paste confirm threshold')
    if (
      !(SettingsStore.TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS as readonly number[]).includes(n)
    ) {
      throw new Error('Invalid paste confirm threshold')
    }
    await settingsStore.setTerminalPasteConfirmMaxChars(n)
  })

  ipcMain.handle('settings:getTerminalCommandSuggestEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalCommandSuggestEnabled()
  })

  ipcMain.handle('settings:setTerminalCommandSuggestEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalCommandSuggestEnabled(!!enabled)
  })

  ipcMain.handle('settings:setTerminalFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || size < 10 || size > 24) {
      throw new Error('Invalid font size')
    }
    await settingsStore.setTerminalFontSize(size)
  })
}
