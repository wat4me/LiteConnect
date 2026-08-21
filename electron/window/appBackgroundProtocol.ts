import { net, protocol } from 'electron'
import { existsSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import { pathToFileURL } from 'url'

export const APP_BG_SCHEME = 'liteconnect-bg'
export const BG_MAX_BYTES = 8 * 1024 * 1024
export const BG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function registerAppBackgroundScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_BG_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

/** Only `wallpaper.<ext>` names are served / persisted. */
export function sanitizeWallpaperFileName(name: string): string | null {
  if (typeof name !== 'string' || !name) return null
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null
  const base = basename(name)
  if (base !== name) return null
  const ext = extname(base).toLowerCase()
  if (!BG_EXTS.has(ext)) return null
  if (!/^wallpaper\.(png|jpe?g|webp|gif|bmp)$/i.test(base)) return null
  return `wallpaper${ext}`
}

export function wallpaperStoredName(ext: string): string | null {
  const e = ext.toLowerCase()
  if (!BG_EXTS.has(e)) return null
  return `wallpaper${e}`
}

export function appBackgroundImageUrl(fileName: string, cacheBust?: number): string {
  const safe = sanitizeWallpaperFileName(fileName)
  if (!safe) return ''
  const q = cacheBust ? `?t=${cacheBust}` : ''
  return `${APP_BG_SCHEME}://wallpaper/${encodeURIComponent(safe)}${q}`
}

export function resolveWallpaperPath(dir: string, fileName: string): string | null {
  const safe = sanitizeWallpaperFileName(fileName)
  if (!safe) return null
  return join(resolve(dir), safe)
}

export function installAppBackgroundProtocol(getDir: () => string): void {
  protocol.handle(APP_BG_SCHEME, async (request) => {
    try {
      const u = new URL(request.url)
      const name = decodeURIComponent(basename(u.pathname))
      const full = resolveWallpaperPath(getDir(), name)
      if (!full || !existsSync(full)) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(full).href)
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

export function mimeForWallpaperExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}
