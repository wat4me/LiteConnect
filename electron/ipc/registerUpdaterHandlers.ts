import type { UpdateStatus } from '../../shared/types/app'
import { ipcMain, BrowserWindow } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { SettingsStore } from '../store/settingsStore'
import { safeSend } from '../utils/validation'

type MainWindowGetter = () => BrowserWindow | null

/**
 * electron-updater is heavy; load it after startup (or on first updater IPC).
 */
export function registerUpdaterHandlers(getMainWindow: MainWindowGetter, settingsStore: SettingsStore): void {
  let autoUpdater: AppUpdater | null = null
  let loadPromise: Promise<AppUpdater> | null = null
  let listenersBound = false
  let status: UpdateStatus | null = null
  let download: Promise<void> | null = null
  function publish(next: UpdateStatus) {
    status = next
    safeSend(getMainWindow(), 'updater:status', next)
  }
  function startDownload(updater: AppUpdater): Promise<void> {
    if (download) return download
    if (status?.status === 'downloaded') return Promise.resolve()
    publish({ status: 'downloading', version: status?.version, progress: 0 })
    download = Promise.resolve().then(() => updater.downloadUpdate()).then(() => {}).catch((err) => {
      publish({ status: 'error', version: status?.version, message: err instanceof Error ? err.message : String(err) })
      throw err
    }).finally(() => { download = null })
    return download
  }

  function bindListeners(updater: AppUpdater) {
    if (listenersBound) return
    listenersBound = true
    updater.logger = console
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true

    updater.on('checking-for-update', () => {
      publish({ status: 'checking' })
    })
    updater.on('update-available', (info) => {
      const skippedVersion = settingsStore.getSkippedUpdateVersion()
      if (info.version === skippedVersion) return
      publish({ status: 'available', version: info.version })
      void startDownload(updater).catch(() => {})
    })
    updater.on('update-not-available', (info) => {
      publish({ status: 'not-available', version: info.version })
    })
    updater.on('download-progress', (progress) => {
      publish({ status: 'downloading', version: status?.version, progress: progress.percent })
    })
    updater.on('update-downloaded', (info) => {
      publish({ status: 'downloaded', version: info.version })
    })
    updater.on('error', (err) => {
      publish({ status: 'error', version: status?.version, message: err.message })
    })
  }

  async function getUpdater(): Promise<AppUpdater> {
    if (autoUpdater) return autoUpdater
    if (!loadPromise) {
      loadPromise = import('electron-updater').then((mod) => {
        autoUpdater = mod.autoUpdater
        bindListeners(autoUpdater)
        return autoUpdater
      })
    }
    return loadPromise
  }

  // Defer first check so it never competes with window + store boot.
  void settingsStore.init().then(() => {
    if (!settingsStore.getAutoUpdateEnabled()) return
    setTimeout(() => {
      void getUpdater()
        .then((updater) => {
          if (!settingsStore.getAutoUpdateEnabled() || download || status?.status === 'downloaded') return
          return updater.checkForUpdates()
        })
        .catch(() => {})
    }, 8000)
  }).catch((err) => {
    console.error('[Updater Init]', err)
  })

  ipcMain.handle('updater:status', () => status)

  ipcMain.handle('updater:check', async () => {
    try {
      await settingsStore.init()
      const updater = await getUpdater()
      if (download || status?.status === 'downloaded') return { ok: true, info: { version: status?.version } }
      const result = await updater.checkForUpdates()
      return { ok: true, info: result?.updateInfo }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      await settingsStore.init()
      const updater = await getUpdater()
      await startDownload(updater)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('updater:install', async () => {
    const updater = await getUpdater()
    if (status?.status !== 'downloaded') throw new Error('Update is not downloaded yet')
    updater.quitAndInstall()
  })

  ipcMain.handle('updater:skipVersion', async (_event, version: string) => {
    if (!version || typeof version !== 'string') throw new Error('Invalid version')
    await settingsStore.init()
    await settingsStore.setSkippedUpdateVersion(version)
  })
}
