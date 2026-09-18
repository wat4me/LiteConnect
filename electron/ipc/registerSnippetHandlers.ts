import { ipcMain, BrowserWindow, dialog } from 'electron'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'

type MainWindowGetter = () => BrowserWindow | null

export function registerSnippetHandlers(
  getMainWindow: MainWindowGetter,
  settingsStore: SettingsStore,
  ensureSettingsStoreReady: () => Promise<void>
): void {
  ipcMain.handle('settings:getCommandSnippets', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getCommandSnippets()
  })

  ipcMain.handle('settings:setCommandSnippets', async (_event, snippets: any) => {
    await ensureSettingsStoreReady()
    return settingsStore.setCommandSnippets(snippets)
  })

  ipcMain.handle('settings:exportCommandSnippets', async () => {
    await ensureSettingsStoreReady()
    const snippets = settingsStore.getCommandSnippets()
    const exportData = {
      version: 1,
      kind: 'LiteConnect-command-snippets',
      exportedAt: new Date().toISOString(),
      snippets: snippets.map((s) => ({
        name: s.name,
        command: s.command,
        group: s.group,
        pinned: s.pinned === true ? true : undefined,
        sendMode: s.sendMode === 'fill' ? 'fill' : undefined,
        hotkey: s.hotkey || undefined,
      })),
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: t('dialog.exportSnippets'),
          defaultPath: 'LiteConnect-command-snippets.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          title: t('dialog.exportSnippets'),
          defaultPath: 'LiteConnect-command-snippets.json',
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

  ipcMain.handle('settings:importCommandSnippets', async (_event, mode: 'append' | 'replace' = 'append') => {
    await ensureSettingsStoreReady()
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.importSnippets'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    try {
      const { readFile } = await import('fs/promises')
      const data = await readFile(result.filePaths[0], 'utf-8')
      const parsed = JSON.parse(data)
      const list = Array.isArray(parsed?.snippets)
        ? parsed.snippets
        : Array.isArray(parsed)
          ? parsed
          : null
      if (!list) throw new Error('Invalid import format')
      const imported = list
        .filter((s: any) => s && typeof s.command === 'string' && s.command.trim())
        .map((s: any) => ({
          name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : t('common.unnamed'),
          command: s.command,
          group: typeof s.group === 'string' && s.group.trim() ? s.group.trim() : undefined,
          pinned: s.pinned === true,
          sendMode: s.sendMode === 'fill' ? ('fill' as const) : ('run' as const),
          hotkey: typeof s.hotkey === 'string' && s.hotkey.trim() ? s.hotkey.trim() : undefined,
        }))
      if (imported.length === 0) throw new Error(t('snippet.noImportable'))
      const existing = mode === 'replace' ? [] : settingsStore.getCommandSnippets()
      const merged = [
        ...existing.map((s) => ({
          id: s.id,
          name: s.name,
          command: s.command,
          group: s.group,
          pinned: s.pinned,
          sortOrder: s.sortOrder,
          sendMode: s.sendMode,
          hotkey: s.hotkey,
          useCount: s.useCount,
          lastUsedAt: s.lastUsedAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        ...imported,
      ]
      const saved = await settingsStore.setCommandSnippets(merged)
      return { imported: imported.length, total: saved.length }
    } catch (err: any) {
      throw new Error(t('common.importFailed', { error: err.message }))
    }
  })
}
