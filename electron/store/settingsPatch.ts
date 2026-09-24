import type { AppSettingsAllPatch } from '../../shared/types/settings'
import { normalizeConnectionSortMode } from '../../shared/connectionSort'
import { sanitizeDbOpenMode } from '../../shared/dbOpenMode'
import { DEFAULT_GLOBAL_HOTKEY, normalizeGlobalHotkey } from '../../shared/globalHotkey'
import { normalizeShellHistoryExcludePatterns } from '../../shared/shellHistoryPrivacy'
import { sanitizeTerminalPasteConfirmMaxChars } from './pasteConfirmMaxChars'
import {
  sanitizeDbDefaultMaxRows,
  sanitizeDbDefaultQueryTimeoutSec,
  sanitizeDbDefaultRunScope,
} from './dbQueryTabDefaults'

type CurrentSettings = {
  connectionUsageStatsEnabled: () => boolean
  appBackground: () => { fileName: string; fit: 'cover' | 'contain' | 'fill'; overlay: number }
}

/** Apply a bulk settings patch without persistence; SettingsStore commits it once. */
export function applySettingsPatch(
  settings: Record<string, any>,
  patch: AppSettingsAllPatch,
  current: CurrentSettings,
): void {
  if (patch.theme !== undefined) settings.theme = patch.theme
  if (patch.customColors !== undefined) settings.customColors = patch.customColors
  if (patch.downloadPath !== undefined) settings.downloadPath = patch.downloadPath
  if (patch.terminalFontSize !== undefined) {
    settings.terminalFontSize = Math.max(10, Math.min(24, Math.round(patch.terminalFontSize)))
  }
  if (patch.terminalFontFamily !== undefined) {
    settings.terminalFontFamily =
      typeof patch.terminalFontFamily === 'string' && patch.terminalFontFamily.trim()
        ? patch.terminalFontFamily.trim()
        : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
  }
  if (patch.terminalPalette !== undefined) {
    const allowed = ['auto', 'dark', 'light', 'eyecare', 'dracula', 'solarized-dark', 'solarized-light', 'monokai']
    if (allowed.includes(patch.terminalPalette)) settings.terminalPalette = patch.terminalPalette
  }
  if (patch.terminalScrollback !== undefined) {
    settings.terminalScrollback = Math.max(2000, Math.min(20000, Math.round(patch.terminalScrollback)))
  }
  if (patch.terminalPasteConfirmEnabled !== undefined) {
    settings.terminalPasteConfirmEnabled = !!patch.terminalPasteConfirmEnabled
  }
  if (patch.terminalPasteConfirmMaxChars !== undefined) {
    settings.terminalPasteConfirmMaxChars = sanitizeTerminalPasteConfirmMaxChars(patch.terminalPasteConfirmMaxChars)
  }
  if (patch.terminalCommandSuggestEnabled !== undefined) {
    settings.terminalCommandSuggestEnabled = !!patch.terminalCommandSuggestEnabled
  }
  if (patch.terminalLocalEchoEnabled !== undefined) {
    settings.terminalLocalEchoEnabled = !!patch.terminalLocalEchoEnabled
  }
  if (patch.terminalCommandHistoryExcludePatterns !== undefined) {
    settings.terminalCommandHistoryExcludePatterns = normalizeShellHistoryExcludePatterns(
      patch.terminalCommandHistoryExcludePatterns,
    )
  }
  if (patch.downloadConflictStrategy !== undefined) {
    const v = patch.downloadConflictStrategy
    if (v === 'overwrite' || v === 'skip' || v === 'rename') settings.downloadConflictStrategy = v
  }
  if (patch.dirTransferConcurrency !== undefined) {
    settings.dirTransferConcurrency = Math.max(1, Math.min(8, Math.round(patch.dirTransferConcurrency)))
  }
  if (patch.dirTransferFailPolicy !== undefined) {
    if (patch.dirTransferFailPolicy === 'continue' || patch.dirTransferFailPolicy === 'stop') {
      settings.dirTransferFailPolicy = patch.dirTransferFailPolicy
    }
  }
  if (patch.dbFontFamily !== undefined) {
    settings.dbFontFamily =
      typeof patch.dbFontFamily === 'string' && patch.dbFontFamily.trim()
        ? patch.dbFontFamily.trim()
        : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
  }
  if (patch.dbFontSize !== undefined) {
    settings.dbFontSize = Math.max(10, Math.min(24, Math.round(patch.dbFontSize)))
  }
  if (patch.dbPageSize !== undefined) {
    const allowed = [50, 100, 200, 500]
    settings.dbPageSize = allowed.includes(patch.dbPageSize) ? patch.dbPageSize : 100
  }
  if (patch.dbConfirmDangerousSql !== undefined) {
    settings.dbConfirmDangerousSql = !!patch.dbConfirmDangerousSql
  }
  if (patch.dbDefaultMaxRows !== undefined) {
    settings.dbDefaultMaxRows = sanitizeDbDefaultMaxRows(patch.dbDefaultMaxRows)
  }
  if (patch.dbDefaultQueryTimeoutSec !== undefined) {
    settings.dbDefaultQueryTimeoutSec = sanitizeDbDefaultQueryTimeoutSec(patch.dbDefaultQueryTimeoutSec)
  }
  if (patch.dbDefaultRunScope !== undefined) {
    settings.dbDefaultRunScope = sanitizeDbDefaultRunScope(patch.dbDefaultRunScope)
  }
  if (patch.dbOpenMode !== undefined) {
    settings.dbOpenMode = sanitizeDbOpenMode(patch.dbOpenMode)
  }
  if (patch.latencyEnabled !== undefined) settings.latencyEnabled = !!patch.latencyEnabled
  if (patch.latencyIntervalMs !== undefined) {
    settings.latencyIntervalMs = Math.max(1000, Math.min(60000, Math.round(patch.latencyIntervalMs)))
  }
  if (patch.connectionUsageStatsEnabled !== undefined) {
    settings.connectionUsageStatsEnabled = !!patch.connectionUsageStatsEnabled
  }
  if (patch.connectionSortMode !== undefined) {
    settings.connectionSortMode = normalizeConnectionSortMode(
      patch.connectionSortMode,
      patch.connectionUsageStatsEnabled ?? current.connectionUsageStatsEnabled(),
    )
  } else if (patch.connectionUsageStatsEnabled === false) {
    settings.connectionSortMode = 'manual'
  }
  if (patch.fancyCursorEnabled !== undefined) settings.fancyCursorEnabled = !!patch.fancyCursorEnabled
  if (patch.fancyCursorStyle !== undefined) {
    const s = patch.fancyCursorStyle
    settings.fancyCursorStyle = s === 'dot' || s === 'trail' || s === 'cross' || s === 'ring' ? s : 'ring'
  }
  if (patch.appBackground !== undefined) {
    const cur = current.appBackground()
    const next = patch.appBackground
    const fit = next.fit === 'contain' || next.fit === 'fill' || next.fit === 'cover' ? next.fit : cur.fit
    const overlay = typeof next.overlay === 'number'
      ? Math.max(0, Math.min(90, Math.round(next.overlay))) : cur.overlay
    const fileName = typeof next.fileName === 'string' ? next.fileName : cur.fileName
    settings.appBackground = { fileName, fit, overlay }
  }
  if (patch.monitorEnabled !== undefined) settings.monitorEnabled = !!patch.monitorEnabled
  if (patch.monitorIntervalMs !== undefined) {
    settings.monitorIntervalMs = Math.max(2000, Math.min(30000, Math.round(patch.monitorIntervalMs)))
  }
  if (patch.autoReconnectEnabled !== undefined) {
    settings.autoReconnectEnabled = !!patch.autoReconnectEnabled
  }
  if (patch.workspaceRestoreEnabled !== undefined) {
    settings.workspaceRestoreEnabled = !!patch.workspaceRestoreEnabled
    if (!settings.workspaceRestoreEnabled) delete settings.workspaceTabs
  }
  if (patch.closeToTrayEnabled !== undefined) {
    settings.closeToTrayEnabled = !!patch.closeToTrayEnabled
  }
  if (patch.globalHotkeyEnabled !== undefined) {
    settings.globalHotkeyEnabled = !!patch.globalHotkeyEnabled
  }
  if (patch.globalHotkey !== undefined) {
    settings.globalHotkey = normalizeGlobalHotkey(patch.globalHotkey) ?? DEFAULT_GLOBAL_HOTKEY
  }
  if (patch.sessionLogEnabled !== undefined) {
    settings.sessionLogEnabled = !!patch.sessionLogEnabled
  }
  if (patch.autoReconnectMaxRetries !== undefined) {
    settings.autoReconnectMaxRetries = Math.max(0, Math.min(20, Math.round(patch.autoReconnectMaxRetries)))
  }
  if (patch.x11AutoStartEnabled !== undefined) {
    settings.x11AutoStartEnabled = !!patch.x11AutoStartEnabled
  }
  if (patch.x11ServerPath !== undefined) {
    settings.x11ServerPath = typeof patch.x11ServerPath === 'string' ? patch.x11ServerPath.trim() : ''
  }
}
