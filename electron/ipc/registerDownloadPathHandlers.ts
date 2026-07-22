import { ipcMain, BrowserWindow, dialog } from 'electron'
import { SettingsStore } from '../store/settingsStore'
import { isStrictPath } from '../utils/validation'

type MainWindowGetter = () => BrowserWindow | null

export function registerDownloadPathHandlers(
  getMainWindow: MainWindowGetter,
  settingsStore: SettingsStore,
  ensureSettingsStoreReady: () => Promise<void>
): void {
  ipcMain.handle('settings:getDownloadPath', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDownloadPath()
  })

  ipcMain.handle('settings:getDefaultDownloadPath', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDefaultDownloadPath()
  })

  ipcMain.handle('settings:getConfiguredDownloadPath', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getConfiguredDownloadPath()
  })

  ipcMain.handle('settings:setDownloadPath', async (_event, dirPath: string) => {
    await ensureSettingsStoreReady()
    if (dirPath !== '' && !isStrictPath(dirPath)) {
      throw new Error('Invalid directory path')
    }
    await settingsStore.setDownloadPath(dirPath)
  })

  ipcMain.handle('settings:selectDirectory', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle('settings:getDownloadConflictStrategy', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDownloadConflictStrategy()
  })

  ipcMain.handle('settings:setDownloadConflictStrategy', async (_event, strategy: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setDownloadConflictStrategy(strategy)
  })

  ipcMain.handle('settings:getDirTransferConcurrency', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDirTransferConcurrency()
  })

  ipcMain.handle('settings:setDirTransferConcurrency', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    await settingsStore.setDirTransferConcurrency(n)
  })

  ipcMain.handle('settings:getDirTransferFailPolicy', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDirTransferFailPolicy()
  })

  ipcMain.handle('settings:setDirTransferFailPolicy', async (_event, policy: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setDirTransferFailPolicy(policy)
  })

  ipcMain.handle('settings:getRecentDownloadPaths', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getRecentDownloadPaths()
  })

  ipcMain.handle('settings:addRecentDownloadPath', async (_event, dirPath: string) => {
    await ensureSettingsStoreReady()
    if (!isStrictPath(dirPath)) {
      throw new Error('Invalid directory path')
    }
    await settingsStore.addRecentDownloadPath(dirPath)
  })
}
