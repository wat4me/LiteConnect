import type { AppSettingsAll, AppSettingsAllPatch } from '@shared/types/settings'
import { useTheme, type Theme } from '@/composables/app/useTheme'
import { applyAppBackground } from '@/composables/app/useAppBackground'
import { dispatchDbSettingsChange } from '@/composables/database/useDbSettings'
import { clampQueryMaxRows, clampQueryTimeoutSec, sanitizeDefaultRunScopePref } from '@/utils/database/queryTabOptions'

/** Apply committed settings locally; this function never writes configuration back to IPC. */
export function applyAppSettings(all: AppSettingsAll, changed?: Array<keyof AppSettingsAllPatch>) {
  const affects = (...keys: Array<keyof AppSettingsAllPatch>) => !changed || keys.some(key => changed.includes(key))
  const send = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }))
  if (affects('theme', 'customColors')) {
    const theme = useTheme()
    theme.setCustomColors(all.customColors || { fontColor: '#e6edf3', bgColor: '#0d1117' })
    if (['dark', 'light', 'eyecare', 'custom'].includes(all.theme)) theme.setTheme(all.theme as Theme)
  }
  if (affects('appBackground')) {
    applyAppBackground(all.appBackground)
    send('app-background-settings-change', all.appBackground)
  }
  if (affects('fancyCursorEnabled', 'fancyCursorStyle')) send('fancy-cursor-settings-change', { enabled: all.fancyCursorEnabled, style: all.fancyCursorStyle })
  if (affects('dbFontFamily', 'dbFontSize', 'dbPageSize', 'dbConfirmDangerousSql', 'dbDefaultMaxRows', 'dbDefaultQueryTimeoutSec', 'dbDefaultRunScope')) {
    dispatchDbSettingsChange({ fontFamily: all.dbFontFamily, fontSize: all.dbFontSize, pageSize: all.dbPageSize as 50 | 100 | 200 | 500,
      confirmDangerousSql: all.dbConfirmDangerousSql !== false, defaultMaxRows: clampQueryMaxRows(all.dbDefaultMaxRows),
      defaultQueryTimeoutSec: clampQueryTimeoutSec(all.dbDefaultQueryTimeoutSec), defaultRunScope: sanitizeDefaultRunScopePref(all.dbDefaultRunScope) })
  }
  if (affects('downloadConflictStrategy')) send('download-conflict-settings-change', { strategy: all.downloadConflictStrategy })
  if (affects('dirTransferConcurrency', 'dirTransferFailPolicy')) send('dir-transfer-settings-change', { concurrency: all.dirTransferConcurrency, failPolicy: all.dirTransferFailPolicy })
  if (affects('sftpFontSize')) send('sftp-font-settings-change', { fontSize: all.sftpFontSize })
  if (affects('terminalFontSize', 'terminalFontFamily')) send('terminal-font-settings-change', { fontSize: all.terminalFontSize, fontFamily: all.terminalFontFamily })
  if (affects('terminalPalette')) send('terminal-palette-change', { palette: all.terminalPalette })
  if (affects('terminalScrollback', 'terminalPasteConfirmEnabled', 'terminalPasteConfirmMaxChars', 'terminalCommandSuggestEnabled', 'terminalLocalEchoEnabled')) {
    send('terminal-behavior-settings-change', { scrollback: all.terminalScrollback, pasteConfirmEnabled: all.terminalPasteConfirmEnabled,
      pasteConfirmMaxChars: all.terminalPasteConfirmMaxChars, commandSuggestEnabled: all.terminalCommandSuggestEnabled, localEchoEnabled: all.terminalLocalEchoEnabled })
  }
  if (affects('latencyEnabled', 'latencyIntervalMs')) send('latency-settings-change', { enabled: all.latencyEnabled, intervalMs: all.latencyIntervalMs })
  if (affects('connectionUsageStatsEnabled')) send('connection-usage-stats-settings-change', { enabled: all.connectionUsageStatsEnabled })
  if (affects('workspaceRestoreEnabled')) send('workspace-restore-settings-change', { enabled: all.workspaceRestoreEnabled })
  if (affects('monitorEnabled', 'monitorIntervalMs')) send('monitor-settings-change', { enabled: all.monitorEnabled, intervalMs: all.monitorIntervalMs })
}
