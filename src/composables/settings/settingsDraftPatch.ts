import type { AppSettingsAllPatch } from '@shared/types/settings'
import type { SettingsDraft } from './useSettingsDraft'
import { sanitizeDbOpenMode } from '@shared/dbOpenMode'
import { sanitizeAppLocale } from '@shared/appLocale'
import { clampQueryMaxRows, clampQueryTimeoutSec, sanitizeDefaultRunScopePref } from '@/utils/database/queryTabOptions'

function writableSettings(d: SettingsDraft): AppSettingsAllPatch {
  return {
    theme: d.theme,
    customColors: { fontColor: d.fontColor, bgColor: d.bgColor },
    fancyCursorEnabled: d.fancyCursorEnabled,
    fancyCursorStyle: d.fancyCursorStyle,
    downloadPath: d.useSystemDownloadPath ? '' : d.downloadPath,
    terminalFontSize: d.terminalFontSize,
    terminalFontFamily: d.terminalFontFamily,
    terminalPalette: d.terminalPalette,
    terminalScrollback: d.terminalScrollback,
    terminalPasteConfirmEnabled: d.terminalPasteConfirmEnabled,
    terminalPasteConfirmMaxChars: d.terminalPasteConfirmMaxChars,
    terminalCommandSuggestEnabled: d.terminalCommandSuggestEnabled,
    terminalLocalEchoEnabled: d.terminalLocalEchoEnabled,
    terminalCommandHistoryExcludePatterns: d.terminalCommandHistoryExcludePatterns.split(/\r?\n/).map(pattern => pattern.trim()).filter(Boolean),
    downloadConflictStrategy: d.downloadConflictStrategy,
    dirTransferConcurrency: d.dirTransferConcurrency,
    dirTransferFailPolicy: d.dirTransferFailPolicy,
    sftpFontSize: d.sftpFontSize,
    dbFontFamily: d.dbFontFamily,
    dbFontSize: d.dbFontSize,
    dbPageSize: d.dbPageSize,
    dbConfirmDangerousSql: d.dbConfirmDangerousSql !== false,
    dbDefaultMaxRows: clampQueryMaxRows(d.dbDefaultMaxRows),
    dbDefaultQueryTimeoutSec: clampQueryTimeoutSec(d.dbDefaultQueryTimeoutSec),
    dbDefaultRunScope: sanitizeDefaultRunScopePref(d.dbDefaultRunScope),
    dbOpenMode: sanitizeDbOpenMode(d.dbOpenMode),
    latencyEnabled: d.latencyEnabled,
    latencyIntervalMs: d.latencyIntervalSec * 1000,
    connectionUsageStatsEnabled: d.connectionUsageStatsEnabled,
    monitorEnabled: d.monitorEnabled,
    monitorIntervalMs: d.monitorIntervalSec * 1000,
    autoReconnectEnabled: d.autoReconnectEnabled,
    autoReconnectMaxRetries: d.autoReconnectMaxRetries,
    workspaceRestoreEnabled: d.workspaceRestoreEnabled,
    closeToTrayEnabled: d.closeToTrayEnabled,
    globalHotkeyEnabled: d.globalHotkeyEnabled,
    globalHotkey: d.globalHotkey,
    sessionLogEnabled: d.sessionLogEnabled,
    x11AutoStartEnabled: d.x11AutoStartEnabled,
    x11ServerPath: d.x11ServerPath,
    locale: sanitizeAppLocale(d.locale),
  }
}

/** Compare persisted values so a stale settings page never re-saves untouched fields. */
export function buildSettingsDraftPatch(draft: SettingsDraft, saved: SettingsDraft, options?: { resetAll: boolean }): AppSettingsAllPatch {
  const next = writableSettings(draft), previous = writableSettings(saved)
  const patch: AppSettingsAllPatch = options?.resetAll ? next : Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(previous[key as keyof AppSettingsAllPatch]),
  ))
  // A preset theme can hide the custom palette while it is edited; retain it for later.
  if (draft.theme === 'custom' && saved.theme !== 'custom') patch.customColors = next.customColors

  const bg = draft.appBackground, before = saved.appBackground
  const background: NonNullable<AppSettingsAllPatch['appBackground']> = {}
  if (bg.token && bg.token !== before.token) background.token = bg.token
  if (bg.cleared && !before.cleared) background.clear = true
  if (options?.resetAll || bg.fit !== before.fit) background.fit = bg.fit
  if (options?.resetAll || bg.overlay !== before.overlay) background.overlay = bg.overlay
  if (Object.keys(background).length) patch.appBackground = background
  return patch
}
