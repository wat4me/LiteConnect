import { BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'path'

const titleBarThemes: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: '#0d1117', symbolColor: '#8b949e' },
  light: { color: '#ffffff', symbolColor: '#656d76' },
  eyecare: { color: '#f5f0e8', symbolColor: '#8a7f70' },
}

export { titleBarThemes }

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
      `img-src 'self' data: blob: ${devOrigin}`,
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
    "img-src 'self' data: blob:",
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

export function createWindow(
  theme: string = 'dark',
  customColors: { fontColor: string; bgColor: string } | null = null,
): BrowserWindow {
  Menu.setApplicationMenu(null)
  installContentSecurityPolicy()

  const titleBarColors = resolveTitleBarColors(theme, customColors)

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'LiteConnect',
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
    },
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) mainWindow.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (process.env.LITECONNECT_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
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

  mainWindow.on('closed', () => {
    // Handled in main.ts
  })

  return mainWindow
}
