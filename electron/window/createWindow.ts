import { BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { registerWindow } from './windowRegistry'

const titleBarThemes: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: '#0d1117', symbolColor: '#8b949e' },
  light: { color: '#ffffff', symbolColor: '#656d76' },
  eyecare: { color: '#f5f0e8', symbolColor: '#8a7f70' },
}

export { titleBarThemes }

export type CreateWindowOptions = {
  theme?: string
  customColors?: { fontColor: string; bgColor: string } | null
  /** Mark as primary app shell window */
  primary?: boolean
  /** Open a focused SSH connection workspace */
  connectionId?: string
  title?: string
  width?: number
  height?: number
  parent?: BrowserWindow | null
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isAppNavigation(url: string): boolean {
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(process.env.VITE_DEV_SERVER_URL).origin
    } catch {
      return false
    }
  }
  return url.startsWith('file://')
}

function resolveTitleBarColors(
  theme: string,
  customColors: { fontColor: string; bgColor: string } | null,
): { color: string; symbolColor: string } {
  const preset = titleBarThemes[theme as keyof typeof titleBarThemes]
  if (preset) return preset
  if (theme === 'custom' && customColors) {
    return { color: customColors.bgColor, symbolColor: customColors.fontColor }
  }
  return titleBarThemes.dark
}

/** Content-Security-Policy for the app window. Dev allows Vite HMR; prod is stricter. */
export function buildContentSecurityPolicy(): string {
  const isDev = !!process.env.VITE_DEV_SERVER_URL
  if (isDev) {
    let devOrigin = 'http://localhost:*'
    try {
      devOrigin = new URL(process.env.VITE_DEV_SERVER_URL!).origin
    } catch {
      // keep fallback
    }
    return [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${devOrigin}`,
      `style-src 'self' 'unsafe-inline' ${devOrigin}`,
      `img-src 'self' data: blob: liteconnect-bg: ${devOrigin}`,
      `font-src 'self' data: ${devOrigin}`,
      `connect-src 'self' ws: wss: ${devOrigin}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: liteconnect-bg:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

let cspFilterInstalled = false

function installContentSecurityPolicy(): void {
  if (cspFilterInstalled) return
  cspFilterInstalled = true
  const csp = buildContentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders || {}) }
    // Override any existing CSP from the server/page
    delete headers['content-security-policy']
    delete headers['Content-Security-Policy']
    headers['Content-Security-Policy'] = [csp]
    callback({ responseHeaders: headers })
  })
}

function buildLoadTarget(connectionId?: string): { type: 'url'; url: string } | { type: 'file'; file: string; search: string } {
  const params = new URLSearchParams()
  if (connectionId) {
    params.set('detached', '1')
    params.set('connectionId', connectionId)
  }
  const qs = params.toString()
  if (process.env.VITE_DEV_SERVER_URL) {
    const u = new URL(process.env.VITE_DEV_SERVER_URL)
    if (qs) {
      for (const [k, v] of params) u.searchParams.set(k, v)
    }
    return { type: 'url', url: u.toString() }
  }
  const file = join(__dirname, '../dist/index.html')
  if (qs) {
    // loadFile supports query via loadURL(file://...)
    return { type: 'url', url: `${pathToFileURL(file).href}?${qs}` }
  }
  return { type: 'file', file, search: '' }
}

export function createWindow(
  themeOrOptions: string | CreateWindowOptions = 'dark',
  customColorsLegacy: { fontColor: string; bgColor: string } | null = null,
): BrowserWindow {
  const opts: CreateWindowOptions =
    typeof themeOrOptions === 'string'
      ? { theme: themeOrOptions, customColors: customColorsLegacy, primary: true }
      : themeOrOptions

  const theme = opts.theme || 'dark'
  const customColors = opts.customColors ?? null

  Menu.setApplicationMenu(null)
  installContentSecurityPolicy()

  const titleBarColors = resolveTitleBarColors(theme, customColors)
  const isDetached = !!opts.connectionId

  const mainWindow = new BrowserWindow({
    width: opts.width ?? (isDetached ? 1100 : 1200),
    height: opts.height ?? (isDetached ? 720 : 800),
    minWidth: isDetached ? 640 : 800,
    minHeight: isDetached ? 480 : 600,
    show: false,
    title: opts.title || 'LiteConnect',
    backgroundColor: titleBarColors.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: titleBarColors.color,
      symbolColor: titleBarColors.symbolColor,
      height: 36,
    },
    icon: join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../build/LiteConnect-app.png' : '../dist/LiteConnect.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      v8CacheOptions: 'code',
    },
  })

  registerWindow(mainWindow, { primary: opts.primary !== false && !isDetached })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show()
  })

  const target = buildLoadTarget(opts.connectionId)
  if (target.type === 'url') {
    void mainWindow.loadURL(target.url)
  } else {
    void mainWindow.loadFile(target.file)
  }

  if (process.env.VITE_DEV_SERVER_URL && process.env.LITECONNECT_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    }
  })

  return mainWindow
}
