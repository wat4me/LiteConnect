import { ipcMain, BrowserWindow, dialog } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { CredentialStore } from '../store/credentialStore'
import { KnownHostsStore } from '../ssh/trust/knownHosts'
import { parseKnownHosts } from '../ssh/openssh/parseSshConfig'
import { importParsedHosts, readSshConfigFile } from '../ssh/openssh/importSshConfig'
import { t } from '../i18n'

type MainWindowGetter = () => BrowserWindow | null

export function registerConnectionsExportHandlers(
  getMainWindow: MainWindowGetter,
  credentialStore: CredentialStore,
  ensureCredentialStoreReady: () => Promise<void>,
): void {
  ipcMain.handle('store:exportConnections', async (_event, includeSecrets = false) => {
    await ensureCredentialStoreReady()
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      includeSecrets: !!includeSecrets,
      connections: credentialStore.getConnectionsForExport(!!includeSecrets),
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
      const stats = await credentialStore.importConnections(parsed.connections)
      return stats
    } catch (err: any) {
      throw new Error(t('common.importFailed', { error: err.message }))
    }
  })

  ipcMain.handle('store:importSshConfig', async () => {
    await ensureCredentialStoreReady()
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.importSshConfig'),
      defaultPath: join(homedir(), '.ssh', 'config'),
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const hosts = await readSshConfigFile(result.filePaths[0])
      const stats = await importParsedHosts(hosts, credentialStore)
      let knownHostsImported = 0
      let knownHostsHashedSkipped = 0
      try {
        const khPath = join(homedir(), '.ssh', 'known_hosts')
        const text = await readFile(khPath, 'utf-8')
        const parsed = parseKnownHosts(text)
        knownHostsHashedSkipped = parsed.hashedSkipped
        const store = new KnownHostsStore()
        await store.init()
        for (const entry of parsed.entries) {
          try {
            await store.updateHostKey(entry.host, entry.port, Buffer.from(entry.keyBase64, 'base64'))
            knownHostsImported++
          } catch {
            // skip bad keys
          }
        }
      } catch {
        // no known_hosts is fine
      }
      return { ...stats, knownHostsImported, knownHostsHashedSkipped }
    } catch (err: any) {
      throw new Error(t('common.importFailed', { error: err.message }))
    }
  })
}
