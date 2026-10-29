import { randomBytes } from 'crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { t } from '../../i18n'
import {
  BG_MAX_BYTES,
  wallpaperStoredName,
  sanitizeWallpaperFileName,
} from '../../window/appBackgroundProtocol'

const pendingWallpaperPicks = new Map<string, { path: string; expires: number }>()
const WALLPAPER_TOKEN_TTL_MS = 10 * 60 * 1000

export function putWallpaperPick(filePath: string): string {
  const token = randomBytes(16).toString('hex')
  pendingWallpaperPicks.set(token, { path: filePath, expires: Date.now() + WALLPAPER_TOKEN_TTL_MS })
  return token
}

function peekWallpaperPick(token: string): string | null {
  const entry = pendingWallpaperPicks.get(token)
  if (!entry || entry.expires < Date.now()) {
    pendingWallpaperPicks.delete(token)
    return null
  }
  return entry.path
}

export async function removeWallpaperFile(dir: string, fileName: string): Promise<void> {
  const safe = sanitizeWallpaperFileName(fileName)
  if (safe) await unlink(join(dir, safe)).catch(() => {})
}

export async function readImageFileCapped(src: string): Promise<Buffer> {
  const st = await stat(src)
  if (!st.isFile() || st.size > BG_MAX_BYTES) {
    throw new Error(t('appBackground.tooLarge'))
  }
  const buf = await readFile(src)
  if (buf.length > BG_MAX_BYTES) throw new Error(t('appBackground.tooLarge'))
  return buf
}

export async function stageWallpaperFromToken(dir: string, token: string) {
  const src = peekWallpaperPick(token)
  if (!src) throw new Error(t('appBackground.invalidType'))
  const ext = extname(src).toLowerCase()
  if (!wallpaperStoredName(ext)) throw new Error(t('appBackground.invalidType'))
  const fileName = `wallpaper-${randomBytes(16).toString('hex')}${ext}`
  const buf = await readImageFileCapped(src)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(join(dir, fileName), buf, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await removeWallpaperFile(dir, fileName)
    throw error
  }
  return {
    fileName,
    commit: () => { pendingWallpaperPicks.delete(token) },
    rollback: () => removeWallpaperFile(dir, fileName),
  }
}
