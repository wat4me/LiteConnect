/** Migrate localStorage keys from liteSSH/liteConnect → LiteConnect (once). */

const KEY_MAP: Array<[legacy: string, next: string]> = [
  ['liteSSH.locale', 'LiteConnect.locale'],
  ['liteConnect.locale', 'LiteConnect.locale'],
  ['liteSSH.batchCommandHistory', 'LiteConnect.batchCommandHistory'],
  ['liteConnect.batchCommandHistory', 'LiteConnect.batchCommandHistory'],
  ['liteSSH.db.savedQueries', 'LiteConnect.db.savedQueries'],
  ['liteConnect.db.savedQueries', 'LiteConnect.db.savedQueries'],
  ['liteSSH.db.showSystemDbs', 'LiteConnect.db.showSystemDbs'],
  ['liteConnect.db.showSystemDbs', 'LiteConnect.db.showSystemDbs'],
  ['liteSSH.dbQueryDrafts.v1', 'LiteConnect.dbQueryDrafts.v1'],
  ['liteConnect.dbQueryDrafts.v1', 'LiteConnect.dbQueryDrafts.v1'],
  ['liteSSH.dbQueryHistory.v1', 'LiteConnect.dbQueryHistory.v1'],
  ['liteConnect.dbQueryHistory.v1', 'LiteConnect.dbQueryHistory.v1'],
  ['liteSSH.onboardingTips.v1', 'LiteConnect.onboardingTips.v1'],
  ['liteConnect.onboardingTips.v1', 'LiteConnect.onboardingTips.v1'],
  ['liteSSH.splitDragTipSeen', 'LiteConnect.splitDragTipSeen'],
  ['liteConnect.splitDragTipSeen', 'LiteConnect.splitDragTipSeen'],
  ['litessh-theme', 'liteconnect-theme'],
  ['litessh-custom-colors', 'liteconnect-custom-colors'],
  ['litessh-sftp-sidebar-width', 'liteconnect-sftp-sidebar-width'],
]

export function migrateLegacyLocalStorage(): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    for (const [legacy, next] of KEY_MAP) {
      if (legacy === next) continue
      if (storage.getItem(next) != null) {
        storage.removeItem(legacy)
        continue
      }
      const value = storage.getItem(legacy)
      if (value == null) continue
      storage.setItem(next, value)
      storage.removeItem(legacy)
    }
  } catch {
    // Storage can be unavailable in restricted contexts.
  }
}

const DURABLE_KEYS = {
  'LiteConnect.dbQueryDrafts.v1': 'db-query-drafts',
  'LiteConnect.db.savedQueries': 'db-saved-queries',
  'LiteConnect.batchCommandHistory': 'batch-command-history',
} as const

/** Move durable renderer data into the main-process SQLite store exactly once. */
export async function migrateDurableLocalStorage(): Promise<void> {
  const entries: Partial<Record<(typeof DURABLE_KEYS)[keyof typeof DURABLE_KEYS], string>> = {}
  try {
    const storage = globalThis.localStorage
    if (!storage || !window.LiteConnect?.migrateRendererState) return
    for (const [legacyKey, databaseKey] of Object.entries(DURABLE_KEYS)) {
      const value = storage.getItem(legacyKey)
      if (value != null) entries[databaseKey as keyof typeof entries] = value
    }
    await window.LiteConnect.migrateRendererState(entries)
    for (const legacyKey of Object.keys(DURABLE_KEYS)) storage.removeItem(legacyKey)
  } catch (error) {
    // Keep localStorage intact so the migration can retry on the next launch.
    console.error('[Renderer Storage Migration]', error)
  }
}

export function getDataTransferConnId(dt: DataTransfer | null | undefined): string {
  if (!dt) return ''
  return (
    dt.getData('application/x-lite-connect-conn') ||
    dt.getData('application/x-lite-ssh-conn') ||
    ''
  )
}

export function dataTransferHasConn(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  const types = Array.from(dt.types || [])
  return (
    types.includes('application/x-lite-connect-conn') ||
    types.includes('application/x-lite-ssh-conn')
  )
}
