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
