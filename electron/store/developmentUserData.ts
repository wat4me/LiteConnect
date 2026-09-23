import { mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { app } from 'electron'

export const DEVELOPMENT_USER_DATA_ENV = 'LITECONNECT_DEV_USER_DATA_DIR'
export const DEFAULT_DEVELOPMENT_USER_DATA_DIRECTORY = 'LiteConnect-Dev'

function comparablePath(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved
}

/**
 * Point every main-process store at an isolated directory during development.
 * This must run before any service reads app.getPath('userData').
 */
export function configureDevelopmentUserDataPath(): string | null {
  const configuredPath = process.env[DEVELOPMENT_USER_DATA_ENV]?.trim()
  if (app.isPackaged) {
    if (configuredPath) {
      console.warn(`[Main] Ignoring ${DEVELOPMENT_USER_DATA_ENV} in a packaged build.`)
    }
    return null
  }

  // Development builds must never silently open the installed application's
  // profile. An explicit path is useful for migration tests; ordinary
  // `npm run dev` gets one stable OS-level development profile automatically.
  const isolatedPath = configuredPath
    ? resolve(configuredPath)
    : join(app.getPath('appData'), DEFAULT_DEVELOPMENT_USER_DATA_DIRECTORY)
  if (comparablePath(isolatedPath) === comparablePath(app.getPath('userData'))) {
    throw new Error(`${DEVELOPMENT_USER_DATA_ENV} must not point to the normal LiteConnect data directory.`)
  }

  mkdirSync(isolatedPath, { recursive: true })
  app.setPath('userData', isolatedPath)
  console.info(`[Main] Using isolated development data: ${isolatedPath}`)
  return isolatedPath
}
