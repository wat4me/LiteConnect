import type { AppSettingsAll, AppSettingsAllPatch } from '@shared/types/settings'
import { sanitizeAppLocale, sanitizeLocalePreference } from '@shared/appLocale'
import { setAppLocale } from '@/i18n'
import { useTheme } from '@/composables/app/useTheme'
import { isAppTheme } from '@shared/appTheme'
import { applyAppBackground } from '@/composables/app/useAppBackground'
import { applyUiSizes } from '@/composables/app/useUiDensity'
import { dispatchDbSettingsChange } from '@/composables/database/useDbSettings'
import { clampQueryMaxRows, clampQueryTimeoutSec, sanitizeDefaultRunScopePref } from '@/utils/database/queryTabOptions'
import { emitAppEvent } from '@/utils/shared/appEvents'

/** Apply committed settings locally; this function never writes configuration back to IPC. */
export function applyAppSettings(all: AppSettingsAll, changed?: Array<keyof AppSettingsAllPatch>) {
  const affects = (...keys: Array<keyof AppSettingsAllPatch>) => !changed || keys.some(key => changed.includes(key))
  if (affects('locale', 'localePreference')) {
    const resolved = sanitizeAppLocale(all.locale)
    setAppLocale(resolved, sanitizeLocalePreference(all.localePreference, resolved))
  }
  if (affects('uiDensity', 'uiFontSize')) applyUiSizes(all)
  if (affects('theme', 'customColors')) {
    const theme = useTheme()
    theme.setCustomColors(all.customColors || { fontColor: '#ece9e1', bgColor: '#262624' })
    if (isAppTheme(all.theme)) theme.setTheme(all.theme)
  }
  if (affects('appBackground')) {
    applyAppBackground(all.appBackground)
    emitAppEvent('app-background-settings-change', all.appBackground)
  }
  if (affects('fancyCursorEnabled', 'fancyCursorStyle')) emitAppEvent('fancy-cursor-settings-change', { enabled: all.fancyCursorEnabled, style: all.fancyCursorStyle })
  if (affects('dbFontFamily', 'dbFontSize', 'dbPageSize', 'dbConfirmDangerousSql', 'dbDefaultMaxRows', 'dbDefaultQueryTimeoutSec', 'dbDefaultRunScope')) {
    dispatchDbSettingsChange({ fontFamily: all.dbFontFamily, fontSize: all.dbFontSize, pageSize: all.dbPageSize as 50 | 100 | 200 | 500,
      confirmDangerousSql: all.dbConfirmDangerousSql !== false, defaultMaxRows: clampQueryMaxRows(all.dbDefaultMaxRows),
      defaultQueryTimeoutSec: clampQueryTimeoutSec(all.dbDefaultQueryTimeoutSec), defaultRunScope: sanitizeDefaultRunScopePref(all.dbDefaultRunScope) })
  }
  if (affects('downloadConflictStrategy')) emitAppEvent('download-conflict-settings-change', { strategy: all.downloadConflictStrategy })
  if (affects('sftpFontSize')) emitAppEvent('sftp-font-settings-change', { fontSize: all.sftpFontSize })
  if (affects('terminalFontSize', 'terminalFontFamily')) emitAppEvent('terminal-font-settings-change', { fontSize: all.terminalFontSize, fontFamily: all.terminalFontFamily })
  if (affects('terminalPalette')) emitAppEvent('terminal-palette-change', { palette: all.terminalPalette })
  if (affects('terminalScrollback', 'terminalPasteConfirmEnabled', 'terminalPasteConfirmMaxChars', 'terminalCommandSuggestEnabled', 'terminalLocalEchoEnabled', 'terminalHighlightEnabled', 'terminalHighlightRules')) {
    emitAppEvent('terminal-behavior-settings-change', { scrollback: all.terminalScrollback, pasteConfirmEnabled: all.terminalPasteConfirmEnabled,
      pasteConfirmMaxChars: all.terminalPasteConfirmMaxChars, commandSuggestEnabled: all.terminalCommandSuggestEnabled, localEchoEnabled: all.terminalLocalEchoEnabled,
      highlightEnabled: all.terminalHighlightEnabled, highlightRules: all.terminalHighlightRules })
  }
  if (affects('latencyEnabled', 'latencyIntervalMs')) emitAppEvent('latency-settings-change', { enabled: all.latencyEnabled, intervalMs: all.latencyIntervalMs })
  if (affects('connectionUsageStatsEnabled')) emitAppEvent('connection-usage-stats-settings-change', { enabled: all.connectionUsageStatsEnabled })
  if (affects('workspaceRestoreEnabled')) emitAppEvent('workspace-restore-settings-change', { enabled: all.workspaceRestoreEnabled })
  if (affects('monitorEnabled', 'monitorIntervalMs')) emitAppEvent('monitor-settings-change', { enabled: all.monitorEnabled, intervalMs: all.monitorIntervalMs })
}
