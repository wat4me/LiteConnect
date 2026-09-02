import { ipcMain } from 'electron'
import type { SettingsIpcCtx } from './ctx'

export function registerDatabaseSettingsHandlers(ctx: SettingsIpcCtx): void {
  const { settingsStore, ensureSettingsStoreReady } = ctx

  ipcMain.handle('settings:getDbFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontFamily()
  })

  ipcMain.handle('settings:setDbFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    if (typeof family !== 'string') throw new Error('Invalid font family')
    await settingsStore.setDbFontFamily(family)
  })

  ipcMain.handle('settings:getDbFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontSize()
  })

  ipcMain.handle('settings:setDbFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid font size')
    await settingsStore.setDbFontSize(size)
  })

  ipcMain.handle('settings:getDbPageSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbPageSize()
  })

  ipcMain.handle('settings:getDbConfirmDangerousSql', async () => {
    await settingsStore.init()
    return settingsStore.getDbConfirmDangerousSql()
  })

  ipcMain.handle('settings:setDbConfirmDangerousSql', async (_event, enabled: boolean) => {
    await settingsStore.init()
    await settingsStore.setDbConfirmDangerousSql(!!enabled)
  })

  ipcMain.handle('settings:setDbPageSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid page size')
    await settingsStore.setDbPageSize(size)
  })

  ipcMain.handle('settings:getDbDefaultMaxRows', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultMaxRows()
  })

  ipcMain.handle('settings:setDbDefaultMaxRows', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid default max rows')
    await settingsStore.setDbDefaultMaxRows(n)
  })

  ipcMain.handle('settings:getDbDefaultQueryTimeoutSec', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultQueryTimeoutSec()
  })

  ipcMain.handle('settings:setDbDefaultQueryTimeoutSec', async (_event, sec: number) => {
    await ensureSettingsStoreReady()
    if (typeof sec !== 'number' || Number.isNaN(sec)) throw new Error('Invalid default query timeout')
    await settingsStore.setDbDefaultQueryTimeoutSec(sec)
  })

  ipcMain.handle('settings:getDbDefaultRunScope', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultRunScope()
  })

  ipcMain.handle('settings:setDbDefaultRunScope', async (_event, scope: string) => {
    await ensureSettingsStoreReady()
    if (typeof scope !== 'string') throw new Error('Invalid default run scope')
    await settingsStore.setDbDefaultRunScope(scope)
  })
}
