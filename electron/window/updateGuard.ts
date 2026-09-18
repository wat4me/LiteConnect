import { app, BrowserWindow, dialog } from 'electron'
import { t } from '../i18n'
import { getActiveUpdateDownload } from '../ipc/registerUpdaterHandlers'

/**
 * 更新下载中退出会直接掐断主进程里的下载请求，且已经写下的临时包会被留在
 * updater 的 pending 目录里（下次下载前才自动清）。国内访问 GitHub 慢，
 * 下到一半被误关代价不小，所以退出前必须问一次。
 *
 * 拦截点选在 `before-quit` 而不是窗口 `close`：`before-quit` 先于窗口 close 触发，
 * 此时还来得及 preventDefault；放行后由原有的 markQuitting 逻辑收尾。
 */
let confirming = false
let quitConfirmed = false

export function installUpdateGuard(): void {
  app.on('before-quit', (event) => {
    if (quitConfirmed || confirming) return
    const active = getActiveUpdateDownload()
    if (!active) return

    event.preventDefault()
    confirming = true
    const percent = Math.max(0, Math.min(100, Math.round(active.progress)))
    const window = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
    const options = {
      type: 'warning' as const,
      buttons: [t('updateGuard.stay'), t('updateGuard.quit')],
      defaultId: 0,
      cancelId: 0,
      title: t('updateGuard.title'),
      message: t('updateGuard.message', { version: active.version, progress: percent }),
      detail: t('updateGuard.detail'),
      noLink: true,
    }

    const pending = window
      ? dialog.showMessageBox(window, options)
      : dialog.showMessageBox(options)

    void pending
      .then(({ response }) => {
        confirming = false
        if (response !== 1) return
        quitConfirmed = true
        app.quit()
      })
      .catch((err) => {
        confirming = false
        console.error('[Update Guard]', err)
      })
  })
}
