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

  function bindListeners(updater: AppUpdater) {
    if (listenersBound) return
    listenersBound = true
    updater.logger = console
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true

    updater.on('checking-for-update', () => {
      safeSend(getMainWindow(), 'updater:status', { status: 'checking' })
    })
    updater.on('update-available', (info) => {
      const skippedVersion = settingsStore.getSkippedUpdateVersion()
      if (info.version === skippedVersion) return
      safeSend(getMainWindow(), 'updater:status', { status: 'available', version: info.version })
    })
    updater.on('update-not-available', (info) => {
      safeSend(getMainWindow(), 'updater:status', { status: 'not-available', version: info.version })
    })
    updater.on('download-progress', (progress) => {
      safeSend(getMainWindow(), 'updater:status', { status: 'downloading', progress: progress.percent })
    })
    updater.on('update-downloaded', (info) => {
      safeSend(getMainWindow(), 'updater:status', { status: 'downloaded', version: info.version })
    })
    updater.on('error', (err) => {
      safeSend(getMainWindow(), 'updater:status', { status: 'error', message: err.message })
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
        .then((updater) => updater.checkForUpdates())
        .catch(() => {})
    }, 8000)
  }).catch((err) => {
    console.error('[Updater Init]', err)
  })

  ipcMain.handle('updater:check', async () => {
    try {
      await settingsStore.init()
      const updater = await getUpdater()
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
      await updater.downloadUpdate()
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('updater:install', async () => {
    const updater = await getUpdater()
    updater.quitAndInstall()
  })

  ipcMain.handle('updater:skipVersion', async (_event, version: string) => {
    if (!version || typeof version !== 'string') throw new Error('Invalid version')
    await settingsStore.init()
    await settingsStore.setSkippedUpdateVersion(version)
  })
}
