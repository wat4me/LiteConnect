import { app, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { t } from '../../i18n'
import type { SettingsIpcCtx } from './ctx'

const BUNDLED_VCXSRV_INSTALLER = 'vcxsrv-64.1.20.14.0.installer.exe'

function bundledX11InstallerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'third-party', BUNDLED_VCXSRV_INSTALLER)
    : join(process.cwd(), 'build', 'third-party', BUNDLED_VCXSRV_INSTALLER)
}

function isUserCancelledOpenPathError(error: string): boolean {
  const s = error.toLowerCase()
  return (
    s.includes('cancel')
    || s.includes('canceled')
    || s.includes('cancelled')
    || s.includes('user abort')
    || s.includes('operation was aborted')
    || s.includes('取消')
    || s.includes('已取消')
  )
}

export function registerX11SettingsHandlers(ctx: SettingsIpcCtx): void {
  const { settingsStore, ensureSettingsStoreReady } = ctx

  ipcMain.handle('settings:getX11AutoStartEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getX11AutoStartEnabled()
  })

  ipcMain.handle('settings:setX11AutoStartEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setX11AutoStartEnabled(!!enabled)
    const { configureX11ServerOptions } = await import('../../ssh/x11/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  })

  ipcMain.handle('settings:getX11ServerPath', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getX11ServerPath()
  })

  ipcMain.handle('settings:setX11ServerPath', async (_event, path: string) => {
    await ensureSettingsStoreReady()
    if (typeof path !== 'string') throw new Error('Invalid path')
    await settingsStore.setX11ServerPath(path)
    const { configureX11ServerOptions } = await import('../../ssh/x11/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  })

  ipcMain.handle('settings:getX11ServerStatus', async (_event, draftExecutablePath?: string) => {
    await ensureSettingsStoreReady()
    const { configureX11ServerOptions, getX11ServerStatus } = await import('../../ssh/x11/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
    return getX11ServerStatus(
      typeof draftExecutablePath === 'string' ? draftExecutablePath : undefined,
    )
  })

  ipcMain.handle(
    'settings:testX11Server',
    async (
      _event,
      opts?: { executablePath?: string; host?: string; display?: number },
    ) => {
      await ensureSettingsStoreReady()
      const { configureX11ServerOptions, testX11ServerReady } = await import('../../ssh/x11/x11Server')
      configureX11ServerOptions({
        autoStart: settingsStore.getX11AutoStartEnabled(),
        executablePath: settingsStore.getX11ServerPath(),
      })
      const executablePath =
        opts && typeof opts.executablePath === 'string'
          ? opts.executablePath
          : settingsStore.getX11ServerPath()
      const host = opts && typeof opts.host === 'string' ? opts.host : '127.0.0.1'
      const display =
        opts && typeof opts.display === 'number' && Number.isInteger(opts.display)
          ? opts.display
          : 0
      return testX11ServerReady({ executablePath, host, display })
    },
  )

  ipcMain.handle(
    'settings:killResidualX11Process',
    async (_event, payload?: { pid?: number; port?: number }) => {
      const { findListeningPortOwner, killPortOwnerProcess, formatPortOwnerLabel } = await import('../../ssh/x11/x11PortOwner')
      const { t: mt } = await import('../../i18n')
      const port =
        payload && typeof payload.port === 'number' && Number.isInteger(payload.port)
          ? payload.port
          : 6000
      const requestedPid =
        payload && typeof payload.pid === 'number' && Number.isInteger(payload.pid)
          ? payload.pid
          : 0

      const owner = await findListeningPortOwner(port)
      if (!owner || owner.pid <= 0) {
        throw new Error(mt('x11.residualKillFailed', { error: 'no listener on port' }))
      }
      if (requestedPid > 0 && owner.pid !== requestedPid) {
        throw new Error(
          mt('x11.residualKillFailed', {
            error: `pid changed (now ${owner.pid})`,
          }),
        )
      }
      if (owner.kind !== 'xserver_residual') {
        throw new Error(mt('x11.residualKillNotAllowed'))
      }
      const result = await killPortOwnerProcess(owner.pid)
      if (!result.ok) {
        throw new Error(mt('x11.residualKillFailed', { error: result.error || 'unknown' }))
      }
      return {
        ok: true as const,
        process: formatPortOwnerLabel(owner),
        pid: owner.pid,
      }
    },
  )

  ipcMain.handle('settings:getBundledX11InstallerStatus', () => ({
    available: existsSync(bundledX11InstallerPath()),
  }))

  ipcMain.handle('settings:installBundledX11Server', async () => {
    const installer = bundledX11InstallerPath()
    if (!existsSync(installer)) {
      throw new Error(t('x11.installerUnavailable'))
    }
    const error = await shell.openPath(installer)
    if (error) {
      if (isUserCancelledOpenPathError(error)) {
        return { started: false as const, cancelled: true as const }
      }
      console.error('[settings:installBundledX11Server] openPath failed:', error)
      throw new Error(t('x11.installerOpenFailed'))
    }
    return { started: true as const }
  })

  ipcMain.handle('settings:selectX11ServerExecutable', async () => {
    const { dialog, BrowserWindow } = await import('electron')
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: (await import('../../i18n')).t('x11.selectExeTitle'),
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
}
