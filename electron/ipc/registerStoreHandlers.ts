import { ipcMain, BrowserWindow, dialog, shell, clipboard, safeStorage } from 'electron'
import { CredentialStore } from '../store/credentialStore'
import { SettingsStore } from '../store/settingsStore'
import {
  isValidUUID,
  isValidHost,
  isValidUsername,
  isValidPort,
  isValidX11Display,
  isLoopbackHost,
  isSafeLocalPath,
  isValidClipboardText,
} from '../utils/validation'
import { CLIPBOARD_MAX_CHARS } from '../utils/constants'
import { t } from '../i18n'
import { registerSettingsHandlers } from './registerSettingsHandlers'
import { registerSnippetHandlers } from './registerSnippetHandlers'
import { registerConnectionsExportHandlers } from './registerConnectionsExportHandlers'
import { registerDownloadPathHandlers } from './registerDownloadPathHandlers'

type MainWindowGetter = () => BrowserWindow | null

export function registerStoreHandlers(
  getMainWindow: MainWindowGetter,
  credentialStore: CredentialStore,
  settingsStore: SettingsStore
): void {
  const ensureCredentialStoreReady = () => credentialStore.init()
  const ensureSettingsStoreReady = () => settingsStore.init()
  const ensureStoresReady = () =>
    Promise.all([ensureCredentialStoreReady(), ensureSettingsStoreReady()])

  async function getRecentConnectionsSnapshot() {
    await ensureStoresReady()
    const recentIds = settingsStore.getRecentConnectionIds()
    const connections = recentIds.reduce<ReturnType<typeof credentialStore.getConnections>>((list, id) => {
      const connection = credentialStore.getConnection(id)
      if (connection) {
        list.push(connection)
      }
      return list
    }, [])

    const validIds = connections.map((connection) => connection.id)
    if (validIds.length !== recentIds.length) {
      await settingsStore.pruneRecentConnectionIds(validIds)
    }

    return connections
  }

  // Title bar theme is registered in registerWindowHandlers (per-window + multi-window)

  ipcMain.handle('app:getBootstrap', async () => {
    await ensureStoresReady()
    const recentConnections = await getRecentConnectionsSnapshot()
    return {
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      connections: credentialStore.getConnections(),
      groups: credentialStore.getGroups(),
      recentConnections,
      latencyEnabled: settingsStore.getLatencyEnabled(),
      latencyIntervalMs: settingsStore.getLatencyIntervalMs(),
      monitorEnabled: settingsStore.getMonitorEnabled(),
      monitorIntervalMs: settingsStore.getMonitorIntervalMs(),
    }
  })

  // Credential store
  ipcMain.handle('store:getConnections', async () => {
    await ensureCredentialStoreReady()
    return credentialStore.getConnections()
  })

  ipcMain.handle('store:saveConnection', async (_event, connection: any) => {
    await ensureCredentialStoreReady()
    if (!connection || typeof connection !== 'object') {
      throw new Error('Invalid connection object')
    }
    if (!connection.name || typeof connection.name !== 'string') {
      throw new Error('Invalid connection name')
    }
    if (!isValidHost(connection.host)) {
      throw new Error('Invalid host')
    }
    if (!isValidUsername(connection.username)) {
      throw new Error('Invalid username')
    }
    if (typeof connection.password !== 'string') {
      throw new Error('Invalid password')
    }
    if (connection.privateKey !== undefined && typeof connection.privateKey !== 'string') {
      throw new Error('Invalid private key')
    }
    if (connection.port !== undefined && !isValidPort(connection.port)) {
      throw new Error('Invalid port')
    }
    if (connection.id !== undefined && !isValidUUID(connection.id)) {
      throw new Error('Invalid connection id')
    }
    if (connection.x11Forwarding !== undefined && typeof connection.x11Forwarding !== 'boolean') {
      throw new Error('Invalid graphical forwarding setting')
    }
    if (connection.x11Host !== undefined && (!isValidHost(connection.x11Host) || !isLoopbackHost(connection.x11Host))) {
      throw new Error('Invalid graphical display host')
    }
    if (connection.x11Display !== undefined && !isValidX11Display(connection.x11Display)) {
      throw new Error('Invalid graphical display number')
    }
    return await credentialStore.saveConnection(connection)
  })

  ipcMain.handle('store:deleteConnection', async (_event, id: string) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid connection id')
    }
    return await credentialStore.deleteConnection(id)
  })

  ipcMain.handle('store:reorderConnections', async (_event, orderedIds: string[]) => {
    await ensureCredentialStoreReady()
    if (!Array.isArray(orderedIds)) {
      throw new Error('Invalid connection order list')
    }
    const ids = orderedIds.filter((id): id is string => typeof id === 'string' && isValidUUID(id))
    await credentialStore.reorderConnections(ids)
  })

  ipcMain.handle('store:updateConnectionGroup', async (_event, id: string, groupId: string | undefined) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid connection id')
    }
    return await credentialStore.updateConnectionGroup(id, groupId)
  })

  ipcMain.handle('store:setConnectionPinned', async (_event, id: string, pinned: boolean) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid connection id')
    }
    return await credentialStore.setConnectionPinned(id, !!pinned)
  })

  ipcMain.handle('store:getConnectionPassword', async (_event, id: string) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid connection id')
    }
    return credentialStore.getConnectionPassword(id) || ''
  })

  ipcMain.handle('store:getSavedCredentials', async () => {
    await ensureCredentialStoreReady()
    return credentialStore.getSavedCredentials()
  })

  ipcMain.handle('store:getSavedCredentialPassword', async (_event, id: string) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid credential id')
    }
    return credentialStore.getSavedCredentialPassword(id) || ''
  })

  ipcMain.handle('store:saveSavedCredential', async (_event, credential: any) => {
    await ensureCredentialStoreReady()
    if (!credential || typeof credential !== 'object') {
      throw new Error('Invalid credential object')
    }
    if (!credential.name || typeof credential.name !== 'string') {
      throw new Error('Invalid credential name')
    }
    if (!isValidUsername(credential.username)) {
      throw new Error('Invalid username')
    }
    if (typeof credential.password !== 'string') {
      throw new Error('Invalid password')
    }
    if (credential.id !== undefined && !isValidUUID(credential.id)) {
      throw new Error('Invalid credential id')
    }
    return await credentialStore.saveSavedCredential(credential)
  })

  ipcMain.handle('store:deleteSavedCredential', async (_event, id: string) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid credential id')
    }
    return await credentialStore.deleteSavedCredential(id)
  })

  ipcMain.handle('store:isEncryptionAvailable', () => {
    return safeStorage.isEncryptionAvailable()
  })

  ipcMain.handle('store:getGroups', async () => {
    await ensureCredentialStoreReady()
    return credentialStore.getGroups()
  })

  ipcMain.handle('store:saveGroup', async (_event, group: any) => {
    await ensureCredentialStoreReady()
    if (!group || typeof group !== 'object') {
      throw new Error('Invalid group object')
    }
    if (!group.name || typeof group.name !== 'string') {
      throw new Error('Invalid group name')
    }
    if (group.id !== undefined && !isValidUUID(group.id)) {
      throw new Error('Invalid group id')
    }
    return await credentialStore.saveGroup(group)
  })

  ipcMain.handle('store:deleteGroup', async (_event, id: string) => {
    await ensureCredentialStoreReady()
    if (!isValidUUID(id)) {
      throw new Error('Invalid group id')
    }
    return await credentialStore.deleteGroup(id)
  })

  ipcMain.handle('store:reorderGroups', async (_event, ids: string[]) => {
    await ensureCredentialStoreReady()
    if (!Array.isArray(ids) || !ids.every(isValidUUID)) {
      throw new Error('Invalid group ids')
    }
    await credentialStore.reorderGroups(ids)
  })

  ipcMain.handle('store:setDefaultGroup', async (_event, id: string | null) => {
    await ensureCredentialStoreReady()
    if (id !== null && !isValidUUID(id)) {
      throw new Error('Invalid group id')
    }
    await credentialStore.setDefaultGroup(id)
  })

  ipcMain.handle('fs:isLocalDirectory', async (_event, dirPath: string) => {
    if (typeof dirPath !== 'string' || !dirPath) return false
    try {
      const { stat } = await import('fs/promises')
      const st = await stat(dirPath)
      return st.isDirectory()
    } catch {
      return false
    }
  })

  ipcMain.handle('dialog:readPrivateKey', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: t('dialog.selectPrivateKey'),
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const { readFile } = await import('fs/promises')
      const content = await readFile(result.filePaths[0], 'utf-8')
      return content
    } catch {
      return null
    }
  })

  // Shell — only absolute local paths
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    if (!isSafeLocalPath(filePath)) {
      throw new Error('Invalid file path')
    }
    return await shell.openPath(filePath)
  })

  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    if (!isSafeLocalPath(filePath)) {
      throw new Error('Invalid file path')
    }
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
      throw new Error('Invalid external URL')
    }
    await shell.openExternal(url.trim())
    return true
  })

  // Clipboard
  ipcMain.handle('clipboard:readText', () => {
    const text = clipboard.readText()
    if (typeof text !== 'string') return ''
    if (text.length > CLIPBOARD_MAX_CHARS) {
      return text.slice(0, CLIPBOARD_MAX_CHARS)
    }
    return text
  })

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    if (!isValidClipboardText(text)) {
      throw new Error(`Invalid clipboard text (max ${CLIPBOARD_MAX_CHARS} chars)`)
    }
    clipboard.writeText(text)
  })

  registerSettingsHandlers(
    credentialStore,
    settingsStore,
    ensureSettingsStoreReady,
    ensureStoresReady,
    getRecentConnectionsSnapshot
  )
  registerSnippetHandlers(getMainWindow, settingsStore, ensureSettingsStoreReady)
  registerConnectionsExportHandlers(getMainWindow, credentialStore, ensureCredentialStoreReady)
  registerDownloadPathHandlers(getMainWindow, settingsStore, ensureSettingsStoreReady)
}
