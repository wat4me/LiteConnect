import type { UpdateStatus } from '../../shared/types/app'
import { ipcMain, BrowserWindow } from 'electron'
import type { AppUpdater, UpdateCheckResult } from 'electron-updater'
import { SettingsStore } from '../store/settingsStore'
import { safeSend } from '../utils/validation'

type MainWindowGetter = () => BrowserWindow | null

/**
 * electron-updater 只在「有新版本」时返回取消令牌，且令牌是一次性的：
 * cancel() 之后 cancelled 永远为 true，无法复用，重试必须换新令牌。
 */
type UpdateCancellationToken = NonNullable<UpdateCheckResult['cancellationToken']>

/**
 * 正在进行的更新下载快照，供退出确认等主进程内部流程读取。
 * 退出流程不能走 IPC 问渲染进程（窗口可能已关），所以由这里持有状态。
 */
export interface UpdateDownloadSnapshot {
  version: string
  progress: number
}

let activeDownload: UpdateDownloadSnapshot | null = null

/** 正在下载更新时返回版本与进度；否则返回 null。 */
export function getActiveUpdateDownload(): UpdateDownloadSnapshot | null {
  return activeDownload
}

type UpdaterOperation = 'check' | 'download'

/**
 * electron-updater often embeds the request URL, response headers, stack and
 * the local app.asar path in `Error.message`. None of that helps an end user,
 * and local paths can contain private information, so updater errors must cross
 * IPC only as a short, actionable message.
 */
export function userFacingUpdaterError(err: unknown, operation: UpdaterOperation): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const text = raw.toLowerCase()

  if (
    text.includes('cannot find latest.yml') ||
    text.includes('cannot find latest-mac.yml') ||
    text.includes('cannot find latest-linux.yml') ||
    (/latest(?:-mac|-linux)?\.yml/.test(text) && /\b404\b/.test(text))
  ) {
    return '新版本仍在发布中，请稍后重试'
  }

  if (
    /\b(enotfound|econnrefused|econnreset|etimedout|err_internet_disconnected|err_network_changed)\b/.test(text) ||
    text.includes('network failed') ||
    text.includes('net::err_')
  ) {
    return '无法连接 GitHub Releases，请检查网络后重试'
  }

  if (/\b(http(?:error)?\s*[: ]\s*)?(401|403|429)\b/.test(text)) {
    return '更新服务器暂时拒绝了请求，请稍后重试'
  }

  return operation === 'download' ? '下载更新失败，请稍后重试' : '检查更新失败，请稍后重试'
}

/**
 * electron-updater is heavy; load it after startup (or on first updater IPC).
 */
export function registerUpdaterHandlers(getMainWindow: MainWindowGetter, settingsStore: SettingsStore): void {
  let autoUpdater: AppUpdater | null = null
  let loadPromise: Promise<AppUpdater> | null = null
  let listenersBound = false
  let status: UpdateStatus | null = null
  let download: Promise<void> | null = null
  let downloadToken: UpdateCancellationToken | null = null
  /** 当前可下载的版本；被用户跳过或已是最新时清空。 */
  let availableVersion: string | null = null
  /** 用户主动取消：由此引发的请求中断不能当作下载失败。 */
  let downloadAborted = false

  function publish(next: UpdateStatus) {
    status = next
    if (next.status === 'downloading') {
      activeDownload = { version: next.version ?? '', progress: next.progress ?? 0 }
    } else {
      activeDownload = null
    }
    safeSend(getMainWindow(), 'updater:status', next)
  }

  function startDownload(updater: AppUpdater): Promise<void> {
    if (download) return download
    if (status?.status === 'downloaded') return Promise.resolve()
    // 无可下载版本，或令牌缺失/已作废（取消后尚未重新检查）：交给调用方补一次检查。
    if (!availableVersion || !downloadToken || downloadToken.cancelled) return Promise.resolve()
    const token = downloadToken
    const version = availableVersion
    downloadAborted = false
    publish({ status: 'downloading', version, progress: 0 })
    download = Promise.resolve().then(() => updater.downloadUpdate(token)).then(() => {}).catch((err) => {
      if (downloadAborted) return
      publish({ status: 'error', version, message: userFacingUpdaterError(err, 'download') })
      throw err
    }).finally(() => { download = null })
    return download
  }

  /**
   * 令牌来自 checkForUpdates 的返回值，而 update-available 事件先于该返回值触发，
   * 所以自动下载只能挂在检查的调用方，不能写在事件回调里。
   */
  async function checkAndDownload(updater: AppUpdater): Promise<UpdateCheckResult | null> {
    const result = await updater.checkForUpdates()
    downloadToken = result?.cancellationToken ?? null
    if (result?.isUpdateAvailable && status?.status !== 'downloaded') {
      void startDownload(updater).catch(() => {})
    }
    return result
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
      if (info.version === skippedVersion) {
        availableVersion = null
        return
      }
      availableVersion = info.version
      publish({ status: 'available', version: info.version })
    })
    updater.on('update-not-available', (info) => {
      availableVersion = null
      publish({ status: 'not-available', version: info.version })
    })
    updater.on('download-progress', (progress) => {
      // 取消后仍可能收到在途的进度事件，别把状态从「已取消」拽回「下载中」。
      if (downloadAborted) return
      publish({ status: 'downloading', version: status?.version, progress: progress.percent })
    })
    updater.on('update-downloaded', (info) => {
      publish({ status: 'downloaded', version: info.version })
    })
    updater.on('error', (err) => {
      if (downloadAborted) return
      const operation: UpdaterOperation = status?.status === 'downloading' ? 'download' : 'check'
      publish({ status: 'error', version: status?.version, message: userFacingUpdaterError(err, operation) })
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
          return checkAndDownload(updater)
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
      const result = await checkAndDownload(updater)
      return { ok: true, info: result?.updateInfo }
    } catch (err: any) {
      return { ok: false, error: userFacingUpdaterError(err, 'check') }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      await settingsStore.init()
      const updater = await getUpdater()
      if (download) return { ok: true }
      if (!availableVersion || !downloadToken || downloadToken.cancelled) {
        await checkAndDownload(updater)
      }
      await startDownload(updater)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: userFacingUpdaterError(err, 'download') }
    }
  })

  ipcMain.handle('updater:cancel-download', () => {
    if (status?.status !== 'downloading' || !download || !downloadToken) return { ok: false }
    downloadAborted = true
    downloadToken.cancel()
    publish({ status: 'cancelled', version: status.version })
    return { ok: true }
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
