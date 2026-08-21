import { app, ipcMain, shell } from 'electron'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { t } from '../i18n'
import { CredentialStore } from '../store/credentialStore'
import { SettingsStore, type SettingsAllPatch } from '../store/settingsStore'
import { isValidUUID } from '../utils/validation'
import {
  BG_EXTS,
  BG_MAX_BYTES,
  mimeForWallpaperExt,
  wallpaperStoredName,
} from '../window/appBackgroundProtocol'

const pendingWallpaperPicks = new Map<string, { path: string; expires: number }>()
const WALLPAPER_TOKEN_TTL_MS = 10 * 60 * 1000

function putWallpaperPick(filePath: string): string {
  const token = randomBytes(16).toString('hex')
  pendingWallpaperPicks.set(token, { path: filePath, expires: Date.now() + WALLPAPER_TOKEN_TTL_MS })
  return token
}

function takeWallpaperPick(token: string): string | null {
  const entry = pendingWallpaperPicks.get(token)
  pendingWallpaperPicks.delete(token)
  if (!entry || entry.expires < Date.now()) return null
  return entry.path
}

async function clearWallpaperDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir)
    for (const f of files) {
      await unlink(join(dir, f)).catch(() => {})
    }
  } catch {
    // dir may not exist yet
  }
}

async function readImageFileCapped(src: string): Promise<Buffer> {
  const st = await stat(src)
  if (!st.isFile() || st.size > BG_MAX_BYTES) {
    throw new Error(t('appBackground.tooLarge'))
  }
  const buf = await readFile(src)
  if (buf.length > BG_MAX_BYTES) throw new Error(t('appBackground.tooLarge'))
  return buf
}

async function persistWallpaperFromToken(dir: string, token: string): Promise<string> {
  const src = takeWallpaperPick(token)
  if (!src) throw new Error(t('appBackground.invalidType'))
  const ext = extname(src).toLowerCase()
  const fileName = wallpaperStoredName(ext)
  if (!fileName) throw new Error(t('appBackground.invalidType'))
  const buf = await readImageFileCapped(src)
  await mkdir(dir, { recursive: true })
  await clearWallpaperDir(dir)
  await writeFile(join(dir, fileName), buf)
  return fileName
}

const BUNDLED_VCXSRV_INSTALLER = 'vcxsrv-64.1.20.14.0.installer.exe'

function bundledX11InstallerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'third-party', BUNDLED_VCXSRV_INSTALLER)
    : join(process.cwd(), 'build', 'third-party', BUNDLED_VCXSRV_INSTALLER)
}

/** Detect UAC / ShellExecute user-cancel messages from shell.openPath. */
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

export function registerSettingsHandlers(
  credentialStore: CredentialStore,
  settingsStore: SettingsStore,
  ensureSettingsStoreReady: () => Promise<void>,
  ensureStoresReady: () => Promise<unknown>,
  getRecentConnectionsSnapshot: () => Promise<ReturnType<CredentialStore['getConnections']>>
): void {
  ipcMain.handle('settings:getRecentConnections', async () => {
    return await getRecentConnectionsSnapshot()
  })

  ipcMain.handle('settings:recordRecentConnection', async (_event, connectionId: string) => {
    await ensureStoresReady()
    if (!isValidUUID(connectionId)) {
      throw new Error('Invalid connection id')
    }
    if (credentialStore.getConnection(connectionId)) {
      await settingsStore.recordRecentConnection(connectionId)
      // Bump useCount / lastConnectedAt when usage stats are enabled
      if (settingsStore.getConnectionUsageStatsEnabled()) {
        await credentialStore.recordConnectionUsage(connectionId)
      }
    }
  })

  ipcMain.handle('settings:getTerminalFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontSize()
  })

  ipcMain.handle('settings:getTerminalFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalFontFamily()
  })

  ipcMain.handle('settings:setTerminalFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalFontFamily(family)
  })

  ipcMain.handle('settings:getDbFontFamily', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontFamily()
  })

  ipcMain.handle('settings:setDbFontFamily', async (_event, family: string) => {
    await ensureSettingsStoreReady()
    if (typeof family !== 'string') throw new Error('Invalid font family')
    await settingsStore.setDbFontFamily(family)
  })

  ipcMain.handle('settings:getDbFontSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbFontSize()
  })

  ipcMain.handle('settings:setDbFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid font size')
    await settingsStore.setDbFontSize(size)
  })

  ipcMain.handle('settings:getDbPageSize', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbPageSize()
  })

  ipcMain.handle('settings:getDbConfirmDangerousSql', async () => {
    await settingsStore.init()
    return settingsStore.getDbConfirmDangerousSql()
  })

  ipcMain.handle('settings:setDbConfirmDangerousSql', async (_event, enabled: boolean) => {
    await settingsStore.init()
    await settingsStore.setDbConfirmDangerousSql(!!enabled)
  })

  ipcMain.handle('settings:setDbPageSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || Number.isNaN(size)) throw new Error('Invalid page size')
    await settingsStore.setDbPageSize(size)
  })

  ipcMain.handle('settings:getDbDefaultMaxRows', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultMaxRows()
  })

  ipcMain.handle('settings:setDbDefaultMaxRows', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid default max rows')
    await settingsStore.setDbDefaultMaxRows(n)
  })

  ipcMain.handle('settings:getDbDefaultQueryTimeoutSec', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultQueryTimeoutSec()
  })

  ipcMain.handle('settings:setDbDefaultQueryTimeoutSec', async (_event, sec: number) => {
    await ensureSettingsStoreReady()
    if (typeof sec !== 'number' || Number.isNaN(sec)) throw new Error('Invalid default query timeout')
    await settingsStore.setDbDefaultQueryTimeoutSec(sec)
  })

  ipcMain.handle('settings:getDbDefaultRunScope', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getDbDefaultRunScope()
  })

  ipcMain.handle('settings:setDbDefaultRunScope', async (_event, scope: string) => {
    await ensureSettingsStoreReady()
    if (typeof scope !== 'string') throw new Error('Invalid default run scope')
    await settingsStore.setDbDefaultRunScope(scope)
  })

  ipcMain.handle('settings:getTerminalPalette', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPalette()
  })

  ipcMain.handle('settings:setTerminalPalette', async (_event, palette: string) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPalette(palette)
  })

  ipcMain.handle('settings:getTerminalScrollback', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalScrollback()
  })

  ipcMain.handle('settings:setTerminalScrollback', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid scrollback')
    await settingsStore.setTerminalScrollback(n)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmEnabled()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalPasteConfirmEnabled(!!enabled)
  })

  ipcMain.handle('settings:getTerminalPasteConfirmMaxChars', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalPasteConfirmMaxChars()
  })

  ipcMain.handle('settings:setTerminalPasteConfirmMaxChars', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number' || Number.isNaN(n)) throw new Error('Invalid paste confirm threshold')
    if (
      !(SettingsStore.TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS as readonly number[]).includes(n)
    ) {
      throw new Error('Invalid paste confirm threshold')
    }
    await settingsStore.setTerminalPasteConfirmMaxChars(n)
  })

  ipcMain.handle('settings:getTerminalCommandSuggestEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getTerminalCommandSuggestEnabled()
  })

  ipcMain.handle('settings:setTerminalCommandSuggestEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setTerminalCommandSuggestEnabled(!!enabled)
  })

  ipcMain.handle('settings:setTerminalFontSize', async (_event, size: number) => {
    await ensureSettingsStoreReady()
    if (typeof size !== 'number' || size < 10 || size > 24) {
      throw new Error('Invalid font size')
    }
    await settingsStore.setTerminalFontSize(size)
  })

  ipcMain.handle('settings:getCredentialAutoFillEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getCredentialAutoFillEnabled()
  })

  ipcMain.handle('settings:setCredentialAutoFillEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setCredentialAutoFillEnabled(enabled)
  })

  ipcMain.handle('settings:getLatencyEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getLatencyEnabled()
  })

  ipcMain.handle('settings:setLatencyEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setLatencyEnabled(enabled)
  })

  ipcMain.handle('settings:getConnectionUsageStatsEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getConnectionUsageStatsEnabled()
  })

  ipcMain.handle('settings:setConnectionUsageStatsEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setConnectionUsageStatsEnabled(enabled)
  })

  ipcMain.handle('settings:getAll', async () => {
    await ensureSettingsStoreReady()
    await settingsStore.initMigrations()
    return settingsStore.getAll()
  })

  ipcMain.handle('settings:setMany', async (_event, patch: SettingsAllPatch & { appBackground?: { token?: string; clear?: boolean; fit?: 'cover' | 'contain' | 'fill'; overlay?: number; fileName?: string } }) => {
    await ensureSettingsStoreReady()
    await settingsStore.initMigrations()
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings')

    const nextPatch: SettingsAllPatch = { ...patch }
    if (patch.appBackground && typeof patch.appBackground === 'object') {
      const dir = settingsStore.getAppBackgroundDir()
      const bg = patch.appBackground
      if (bg.clear) {
        await mkdir(dir, { recursive: true })
        await clearWallpaperDir(dir)
        nextPatch.appBackground = { fileName: '', fit: bg.fit, overlay: bg.overlay }
      } else if (typeof bg.token === 'string' && bg.token) {
        const fileName = await persistWallpaperFromToken(dir, bg.token)
        nextPatch.appBackground = { fileName, fit: bg.fit, overlay: bg.overlay }
      } else {
        nextPatch.appBackground = { fit: bg.fit, overlay: bg.overlay }
      }
    }

    const saved = await settingsStore.applyMany(nextPatch)
    if (patch.x11AutoStartEnabled !== undefined || patch.x11ServerPath !== undefined) {
      const { configureX11ServerOptions } = await import('../ssh/x11/x11Server')
      configureX11ServerOptions({
        autoStart: settingsStore.getX11AutoStartEnabled(),
        executablePath: settingsStore.getX11ServerPath(),
      })
    }
    return saved
  })

  ipcMain.handle('settings:getAppBackground', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAll().appBackground
  })

  ipcMain.handle('settings:selectAppBackgroundImage', async () => {
    await ensureSettingsStoreReady()
    const { dialog, BrowserWindow } = await import('electron')
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: t('appBackground.pickTitle'),
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const src = result.filePaths[0]
    const ext = extname(src).toLowerCase()
    if (!BG_EXTS.has(ext)) {
      throw new Error(t('appBackground.invalidType'))
    }
    const buf = await readImageFileCapped(src)
    const token = putWallpaperPick(src)
    const imageUrl = `data:${mimeForWallpaperExt(ext)};base64,${buf.toString('base64')}`
    return {
      token,
      fileName: basename(src),
      imageUrl,
    }
  })

  ipcMain.handle(
    'settings:setAppBackgroundImage',
    async (
      _event,
      payload: {
        token?: string
        fit?: 'cover' | 'contain' | 'fill'
        overlay?: number
        clear?: boolean
      },
    ) => {
      await ensureSettingsStoreReady()
      const dir = settingsStore.getAppBackgroundDir()
      if (payload?.clear) {
        await mkdir(dir, { recursive: true })
        await clearWallpaperDir(dir)
        await settingsStore.clearAppBackgroundFile()
        if (payload.fit != null || payload.overlay != null) {
          await settingsStore.setAppBackground({ fit: payload.fit, overlay: payload.overlay })
        }
        return settingsStore.getAll().appBackground
      }
      let fileName = settingsStore.getAppBackground().fileName
      if (payload?.token) {
        fileName = await persistWallpaperFromToken(dir, payload.token)
      }
      await settingsStore.setAppBackground({
        fileName,
        fit: payload?.fit,
        overlay: payload?.overlay,
      })
      return settingsStore.getAll().appBackground
    },
  )

  ipcMain.handle('settings:getFancyCursorEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getFancyCursorEnabled()
  })

  ipcMain.handle('settings:setFancyCursorEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setFancyCursorEnabled(enabled)
  })

  ipcMain.handle('settings:getFancyCursorStyle', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getFancyCursorStyle()
  })

  ipcMain.handle('settings:setFancyCursorStyle', async (_event, style: string) => {
    await ensureSettingsStoreReady()
    if (typeof style !== 'string') {
      throw new Error('Invalid value')
    }
    await settingsStore.setFancyCursorStyle(style)
  })

  ipcMain.handle('settings:getLatencyIntervalMs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getLatencyIntervalMs()
  })

  ipcMain.handle('settings:setLatencyIntervalMs', async (_event, intervalMs: number) => {
    await ensureSettingsStoreReady()
    if (typeof intervalMs !== 'number' || intervalMs < 1000 || intervalMs > 60000) {
      throw new Error('Invalid interval')
    }
    await settingsStore.setLatencyIntervalMs(intervalMs)
  })

  ipcMain.handle('settings:getAutoReconnectEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoReconnectEnabled()
  })

  ipcMain.handle('settings:setAutoReconnectEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setAutoReconnectEnabled(!!enabled)
  })

  ipcMain.handle('settings:getAutoReconnectMaxRetries', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoReconnectMaxRetries()
  })

  ipcMain.handle('settings:setAutoReconnectMaxRetries', async (_event, n: number) => {
    await ensureSettingsStoreReady()
    if (typeof n !== 'number') throw new Error('Invalid retries')
    await settingsStore.setAutoReconnectMaxRetries(n)
  })

  ipcMain.handle('settings:getX11AutoStartEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getX11AutoStartEnabled()
  })

  ipcMain.handle('settings:setX11AutoStartEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setX11AutoStartEnabled(!!enabled)
    const { configureX11ServerOptions } = await import('../ssh/x11/x11Server')
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
    const { configureX11ServerOptions } = await import('../ssh/x11/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
  })

  ipcMain.handle('settings:getX11ServerStatus', async (_event, draftExecutablePath?: string) => {
    await ensureSettingsStoreReady()
    const { configureX11ServerOptions, getX11ServerStatus } = await import('../ssh/x11/x11Server')
    configureX11ServerOptions({
      autoStart: settingsStore.getX11AutoStartEnabled(),
      executablePath: settingsStore.getX11ServerPath(),
    })
    return getX11ServerStatus(
      typeof draftExecutablePath === 'string' ? draftExecutablePath : undefined,
    )
  })

  /** Probe / auto-start local X (VcXsrv) without opening an SSH session. */
  ipcMain.handle(
    'settings:testX11Server',
    async (
      _event,
      opts?: { executablePath?: string; host?: string; display?: number },
    ) => {
      await ensureSettingsStoreReady()
      const { configureX11ServerOptions, testX11ServerReady } = await import('../ssh/x11/x11Server')
      // Keep live config in sync with saved settings; draft path is applied only for this test.
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

  /**
   * Kill a process previously identified as residual X server on the display port.
   * Only allows image names classified as xserver_residual for the given PID.
   */
  ipcMain.handle(
    'settings:killResidualX11Process',
    async (_event, payload?: { pid?: number; port?: number }) => {
      const { findListeningPortOwner, killPortOwnerProcess, formatPortOwnerLabel } = await import('../ssh/x11/x11PortOwner')
      const { t: mt } = await import('../i18n')
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
      // UAC / 安全提示点「否」时，按用户取消处理，不抛系统英文错误
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
      title: (await import('../i18n')).t('x11.selectExeTitle'),
      filters: [
        { name: 'Executable', extensions: ['exe'] },
        { name: 'All', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:getMonitorEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getMonitorEnabled()
  })

  ipcMain.handle('settings:setMonitorEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid value')
    }
    await settingsStore.setMonitorEnabled(enabled)
  })

  ipcMain.handle('settings:getMonitorIntervalMs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getMonitorIntervalMs()
  })

  ipcMain.handle('settings:setMonitorIntervalMs', async (_event, intervalMs: number) => {
    await ensureSettingsStoreReady()
    if (typeof intervalMs !== 'number' || intervalMs < 2000 || intervalMs > 30000) {
      throw new Error('Invalid interval')
    }
    await settingsStore.setMonitorIntervalMs(intervalMs)
  })

  ipcMain.handle('settings:getAutoUpdateEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getAutoUpdateEnabled()
  })

  ipcMain.handle('settings:setAutoUpdateEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setAutoUpdateEnabled(enabled)
  })

  ipcMain.handle('settings:getSkippedUpdateVersion', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getSkippedUpdateVersion()
  })

  ipcMain.handle('settings:setSkippedUpdateVersion', async (_event, version: string) => {
    await ensureSettingsStoreReady()
    if (!version || typeof version !== 'string') {
      throw new Error('Invalid version')
    }
    await settingsStore.setSkippedUpdateVersion(version)
  })

  ipcMain.handle('settings:getWorkspaceRestoreEnabled', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getWorkspaceRestoreEnabled()
  })

  ipcMain.handle('settings:setWorkspaceRestoreEnabled', async (_event, enabled: boolean) => {
    await ensureSettingsStoreReady()
    await settingsStore.setWorkspaceRestoreEnabled(!!enabled)
  })

  ipcMain.handle('settings:getWorkspaceTabs', async () => {
    await ensureSettingsStoreReady()
    return settingsStore.getWorkspaceTabs()
  })

  ipcMain.handle('settings:setWorkspaceTabs', async (_event, state: unknown) => {
    await ensureSettingsStoreReady()
    if (state == null) {
      await settingsStore.setWorkspaceTabs(null)
      return
    }
    if (!state || typeof state !== 'object') throw new Error('Invalid workspace')
    await settingsStore.setWorkspaceTabs(state as any)
  })
}
