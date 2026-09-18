export const DB_OPEN_MODES = ['currentWindow', 'newWindow'] as const

export type DbOpenMode = (typeof DB_OPEN_MODES)[number]

/** Preserve the historical SSH → DB behavior (dedicated OS window). */
export const DEFAULT_DB_OPEN_MODE: DbOpenMode = 'newWindow'

export function sanitizeDbOpenMode(raw: unknown): DbOpenMode {
  return raw === 'currentWindow' || raw === 'newWindow' ? raw : DEFAULT_DB_OPEN_MODE
}

export type SshToDbNavigation = 'noop' | DbOpenMode

/**
 * Titlebar SSH → DB:
 * - dedicated DB window (`?mode=db`) stays put
 * - already showing DB in this window stays in-place
 * - otherwise honor the persisted open-mode setting
 */
export function resolveSshToDbNavigation(opts: {
  isDedicatedDbWindow: boolean
  alreadyInDatabaseMode: boolean
  openMode: unknown
}): SshToDbNavigation {
  if (opts.isDedicatedDbWindow) return 'noop'
  if (opts.alreadyInDatabaseMode) return 'currentWindow'
  return sanitizeDbOpenMode(opts.openMode)
}
