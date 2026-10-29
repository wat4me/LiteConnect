import type { AppSettingsAllPatch } from '../../../shared/types/settings'
import type { SettingsIpcCtx } from './ctx'
import { removeWallpaperFile, stageWallpaperFromToken } from './wallpaper'

/** Keep the currently referenced image until both the new file and settings are committed. */
export async function commitSettings(ctx: SettingsIpcCtx, patch: AppSettingsAllPatch) {
  const { settingsStore } = ctx
  const next = { ...patch }
  const bg = patch.appBackground
  let staged: Awaited<ReturnType<typeof stageWallpaperFromToken>> | undefined
  let dir = ''
  if (bg) {
    dir = settingsStore.getAppBackgroundDir()
    if (!bg.clear && bg.token) staged = await stageWallpaperFromToken(dir, bg.token)
    next.appBackground = { fit: bg.fit, overlay: bg.overlay,
      ...(bg.clear ? { fileName: '' } : staged ? { fileName: staged.fileName } : {}) }
  }
  const previous = bg ? settingsStore.getAppBackground().fileName : ''
  let saved
  try {
    saved = await settingsStore.applyMany(next)
  } catch (error) {
    await staged?.rollback()
    throw error
  }
  staged?.commit()
  if (bg && previous && previous !== saved.appBackground.fileName) await removeWallpaperFile(dir, previous)
  return settingsStore.getAll()
}
