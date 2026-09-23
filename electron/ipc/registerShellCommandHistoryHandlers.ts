import { ipcMain } from 'electron'
import { isValidUUID } from '../utils/validation'
import type { ShellCommandHistoryStore } from '../store/shellCommandHistoryStore'
import type { SettingsStore } from '../store/settingsStore'

export function registerShellCommandHistoryHandlers(
  store: ShellCommandHistoryStore,
  settingsStore: SettingsStore,
): void {
  const ready = async () => {
    await Promise.all([store.init(), settingsStore.init()])
    store.setExcludePatterns(settingsStore.getTerminalCommandHistoryExcludePatterns())
  }

  ipcMain.handle('shellHistory:list', async (_event, connectionId: string) => {
    await ready()
    if (!isValidUUID(connectionId)) return []
    return store.list(connectionId)
  })

  ipcMain.handle('shellHistory:push', async (_event, connectionId: string, command: string) => {
    await ready()
    if (!isValidUUID(connectionId)) return []
    if (typeof command !== 'string') return store.list(connectionId)
    return store.push(connectionId, command)
  })

  ipcMain.handle('shellHistory:clear', async (_event, connectionId?: string) => {
    await ready()
    if (connectionId != null && connectionId !== '' && !isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    await store.clear(connectionId || undefined)
    return true
  })
}
