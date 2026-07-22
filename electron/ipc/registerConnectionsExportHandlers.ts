import { ipcMain, BrowserWindow, dialog } from 'electron'
import { CredentialStore } from '../store/credentialStore'
import { isValidHost, isLoopbackHost, isValidX11Display } from '../utils/validation'
import { t } from '../i18n'

type MainWindowGetter = () => BrowserWindow | null

export function registerConnectionsExportHandlers(
  getMainWindow: MainWindowGetter,
  credentialStore: CredentialStore,
  ensureCredentialStoreReady: () => Promise<void>
): void {
  ipcMain.handle('store:exportConnections', async () => {
    await ensureCredentialStoreReady()
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: credentialStore.getConnectionsForExport(),
      groups: credentialStore.getGroups(),
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: t('dialog.exportConnections'),
          defaultPath: 'LiteConnect-connections.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          title: t('dialog.exportConnections'),
          defaultPath: 'LiteConnect-connections.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
    if (result.canceled || !result.filePath) return false
    try {
      const { writeFile } = await import('fs/promises')
      await writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
      return true
    } catch {
      throw new Error(t('common.exportWriteFailed'))
    }
  })

  ipcMain.handle('store:importConnections', async () => {
    await ensureCredentialStoreReady()
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.importConnections'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const { readFile } = await import('fs/promises')
      const data = await readFile(result.filePaths[0], 'utf-8')
      const parsed = JSON.parse(data)
      if (!parsed.connections || !Array.isArray(parsed.connections)) {
        throw new Error('Invalid import format')
      }
      let imported = 0
      for (const conn of parsed.connections) {
        if (!conn.name || !conn.host || !conn.username) continue
        const existing = credentialStore.getConnections().find(
          (c: any) => c.host === conn.host && c.username === conn.username && c.port === (conn.port || 22)
        )
        if (existing) continue
        const x11Forwarding = conn.x11Forwarding === true
        const x11Host = typeof conn.x11Host === 'string' && isValidHost(conn.x11Host) && isLoopbackHost(conn.x11Host)
          ? conn.x11Host
          : undefined
        const x11Display = isValidX11Display(conn.x11Display) ? conn.x11Display : undefined
        await credentialStore.saveConnection({
          name: conn.name,
          host: conn.host,
          port: conn.port || 22,
          username: conn.username,
          password: conn.password || '',
          group: conn.group || undefined,
          keepaliveInterval: conn.keepaliveInterval,
          x11Forwarding,
          x11Host: x11Forwarding ? x11Host : undefined,
          x11Display: x11Forwarding ? x11Display : undefined,
          createdAt: conn.createdAt,
          updatedAt: conn.updatedAt,
        })
        imported++
      }
      return { imported, total: parsed.connections.length }
    } catch (err: any) {
      throw new Error(t('common.importFailed', { error: err.message }))
    }
  })
}
