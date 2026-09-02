import { randomBytes } from 'crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { t } from '../../i18n'
import {
  BG_MAX_BYTES,
  wallpaperStoredName,
} from '../../window/appBackgroundProtocol'

const pendingWallpaperPicks = new Map<string, { path: string; expires: number }>()
const WALLPAPER_TOKEN_TTL_MS = 10 * 60 * 1000

export function putWallpaperPick(filePath: string): string {
  const token = randomBytes(16).toString('hex')
  pendingWallpaperPicks.set(token, { path: filePath, expires: Date.now() + WALLPAPER_TOKEN_TTL_MS })
  return token
}

export function takeWallpaperPick(token: string): string | null {
  const entry = pendingWallpaperPicks.get(token)
  pendingWallpaperPicks.delete(token)
  if (!entry || entry.expires < Date.now()) return null
  return entry.path
}

export async function clearWallpaperDir(dir: string): Promise<void> {
  try {
    const files = await readdir(dir)
    for (const f of files) {
      await unlink(join(dir, f)).catch(() => {})
    }
  } catch {
    // dir may not exist yet
  }
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

export async function persistWallpaperFromToken(dir: string, token: string): Promise<string> {
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
