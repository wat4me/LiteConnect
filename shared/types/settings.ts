import type { Connection, Group } from './connection'
import type { ConnectionSortMode } from '../connectionSort'
import type { DbOpenMode } from '../dbOpenMode'

export type AppBackgroundFit = 'cover' | 'contain' | 'fill'

export type AppBackgroundState = {
  fileName: string
  fit: AppBackgroundFit
  overlay: number
  imageUrl: string
}

export interface WorkspaceTabsState {
  version: 1
  homeActive: boolean
  activeConnectionId: string | null
  groups: Array<{
    connectionId: string
    sessionCount: number
    activeIndex: number
    /** Stable terminal identities let restored tabs reconnect in place. */
    sessionIds?: string[]
  }>
}

export type AppSettingsAll = {
  theme: string
  customColors: { fontColor: string; bgColor: string } | null
  downloadPath: string
  configuredDownloadPath: string
  defaultDownloadPath: string
  terminalFontSize: number
  terminalFontFamily: string
  terminalPalette: string
  terminalScrollback: number
  terminalPasteConfirmEnabled: boolean
  terminalPasteConfirmMaxChars: number
  terminalCommandSuggestEnabled: boolean
  terminalLocalEchoEnabled: boolean
  /** Case-insensitive shell globs; matching commands never enter local history. */
  terminalCommandHistoryExcludePatterns: string[]
  downloadConflictStrategy: 'overwrite' | 'skip' | 'rename'
  dirTransferConcurrency: number
  dirTransferFailPolicy: 'continue' | 'stop'
  dbFontFamily: string
  dbFontSize: number
  dbPageSize: number
  dbConfirmDangerousSql: boolean
  dbDefaultMaxRows: number
  dbDefaultQueryTimeoutSec: number
  dbDefaultRunScope: string
  /** Titlebar SSH → DB: stay in this window, or open the dedicated DB window. */
  dbOpenMode: DbOpenMode
  latencyEnabled: boolean
  latencyIntervalMs: number
  connectionUsageStatsEnabled: boolean
  connectionSortMode: ConnectionSortMode
  fancyCursorEnabled: boolean
  fancyCursorStyle: string
  appBackground: AppBackgroundState
  monitorEnabled: boolean
  monitorIntervalMs: number
  autoReconnectEnabled: boolean
  workspaceRestoreEnabled: boolean
  closeToTrayEnabled: boolean
  globalHotkeyEnabled: boolean
  /** Electron accelerator, e.g. `Alt+Shift+L`; falls back to the default when invalid. */
  globalHotkey: string
  sessionLogEnabled: boolean
  autoReconnectMaxRetries: number
  x11AutoStartEnabled: boolean
  x11ServerPath: string
  recentDownloadPaths: string[]
}

export type AppSettingsAllPatch = Partial<
  Omit<AppSettingsAll, 'appBackground' | 'configuredDownloadPath' | 'defaultDownloadPath' | 'recentDownloadPaths'>
> & {
  appBackground?: {
    token?: string
    clear?: boolean
    fileName?: string
    fit?: AppBackgroundFit
    overlay?: number
  }
  downloadPath?: string
}

export interface AppBootstrapData {
  encryptionAvailable: boolean
  connections: Connection[]
  groups: Group[]
  recentConnections: Connection[]
  latencyEnabled: boolean
  latencyIntervalMs: number
  monitorEnabled: boolean
  monitorIntervalMs: number
  fancyCursorEnabled: boolean
  fancyCursorStyle: string
  appBackground: AppBackgroundState
}
