import { computed, onMounted, ref, type Ref, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '@/i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  useTheme,
  pickInstalledFontFamily,
  type TerminalPaletteId,
  type Theme,
} from '@/composables/app/useTheme'
import { dispatchDbSettingsChange } from '@/composables/database/useDbSettings'
import {
  DB_PAGE_SIZE_OPTIONS,
  DEFAULT_DB_DEFAULT_MAX_ROWS,
  DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
  DEFAULT_DB_DEFAULT_RUN_SCOPE,
  DEFAULT_DB_FONT_FAMILY,
  DEFAULT_DB_FONT_SIZE,
  DEFAULT_DB_PAGE_SIZE,
  type DbPageSize,
} from '@/utils/database/dbSettingsDefaults'
import {
  clampQueryMaxRows,
  clampQueryTimeoutSec,
  sanitizeDefaultRunScopePref,
  type QueryDefaultRunScopePref,
} from '@/utils/database/queryTabOptions'
import {
  PASTE_CONFIRM_MAX_CHARS,
  normalizePasteConfirmMaxChars,
  type PasteConfirmMaxChars,
} from '@/utils/terminal/terminalPaste'
import {
  sanitizeFancyCursorStyle,
  type FancyCursorStyle,
} from '@/composables/app/useFancyCursor'
import {
  applyAppBackground,
  clampBackgroundOverlay,
  emptyAppBackgroundState,
  sanitizeAppBackgroundFit,
  type AppBackgroundFit,
  type AppBackgroundState,
} from '@/composables/app/useAppBackground'

export interface SettingsDraft {
  theme: Theme
  bgColor: string
  fontColor: string
  /** Display path (always a concrete directory) */
  downloadPath: string
  /** When true, save writes empty string → store falls back to OS Downloads */
  useSystemDownloadPath: boolean
  terminalFontSize: number
  terminalFontFamily: string
  terminalPalette: TerminalPaletteId
  terminalScrollback: number
  terminalPasteConfirmEnabled: boolean
  /** Single-line paste confirm threshold; multiline always confirms when enabled */
  terminalPasteConfirmMaxChars: PasteConfirmMaxChars
  /** Local shell history / parameter popup. Defaults off. */
  terminalCommandSuggestEnabled: boolean
  downloadConflictStrategy: 'overwrite' | 'skip' | 'rename'
  dirTransferConcurrency: number
  dirTransferFailPolicy: 'continue' | 'stop'
  dbFontFamily: string
  dbFontSize: number
  dbPageSize: DbPageSize
  dbConfirmDangerousSql: boolean
  /** Global default max rows for new query tabs (1..100000). */
  dbDefaultMaxRows: number
  /** Global default query timeout for new query tabs (seconds, 1..600). */
  dbDefaultQueryTimeoutSec: number
  /** Global default run scope for new query tabs. */
  dbDefaultRunScope: QueryDefaultRunScopePref
  latencyEnabled: boolean
  latencyIntervalSec: number
  /** Record/show connection useCount & lastConnectedAt; sort by recent/frequent. Default on. */
  connectionUsageStatsEnabled: boolean
  /** Decorative cursor. Default off. */
  fancyCursorEnabled: boolean
  /** ring | dot | trail | cross */
  fancyCursorStyle: FancyCursorStyle
  /** Custom wallpaper (draft: imageUrl + picker token) */
  appBackground: AppBackgroundState
  monitorEnabled: boolean
  monitorIntervalSec: number
  autoReconnectEnabled: boolean
  autoReconnectMaxRetries: number
  /** Remember open SSH tabs after quit. Default off. */
  workspaceRestoreEnabled: boolean
  /** Hide to tray on window close instead of quitting. Default off. */
  closeToTrayEnabled: boolean
  /** Global hotkey (Alt+Shift+L) to show/hide the window. Default off. */
  globalHotkeyEnabled: boolean
  /** Append remote shell output to per-session log files. Default off. */
  sessionLogEnabled: boolean
  x11AutoStartEnabled: boolean
  x11ServerPath: string
}

export function createEmptyDraft(): SettingsDraft {
  return {
    theme: 'dark',
    bgColor: '#0d1117',
    fontColor: '#e6edf3',
    downloadPath: '',
    useSystemDownloadPath: true,
    terminalFontSize: 14,
    terminalFontFamily: pickInstalledFontFamily(),
    terminalPalette: 'auto',
    terminalScrollback: 5000,
    terminalPasteConfirmEnabled: true,
    terminalPasteConfirmMaxChars: PASTE_CONFIRM_MAX_CHARS,
    terminalCommandSuggestEnabled: false,
    downloadConflictStrategy: 'rename',
    dirTransferConcurrency: 3,
    dirTransferFailPolicy: 'stop',
    dbFontFamily: DEFAULT_DB_FONT_FAMILY,
    dbFontSize: DEFAULT_DB_FONT_SIZE,
    dbPageSize: DEFAULT_DB_PAGE_SIZE,
    dbConfirmDangerousSql: true,
    dbDefaultMaxRows: DEFAULT_DB_DEFAULT_MAX_ROWS,
    dbDefaultQueryTimeoutSec: DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
    dbDefaultRunScope: DEFAULT_DB_DEFAULT_RUN_SCOPE,
    latencyEnabled: true,
    latencyIntervalSec: 10,
    connectionUsageStatsEnabled: true,
    fancyCursorEnabled: false,
    fancyCursorStyle: 'ring',
    appBackground: emptyAppBackgroundState(),
    monitorEnabled: true,
    monitorIntervalSec: 5,
    autoReconnectEnabled: true,
    autoReconnectMaxRetries: 5,
    workspaceRestoreEnabled: false,
    closeToTrayEnabled: false,
    globalHotkeyEnabled: false,
    sessionLogEnabled: false,
    x11AutoStartEnabled: true,
    x11ServerPath: '',
  }
}

export function cloneDraft(d: SettingsDraft): SettingsDraft {
  return {
    ...d,
    appBackground: { ...d.appBackground },
  }
}

function draftsEqual(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.theme === b.theme
    && a.bgColor === b.bgColor
    && a.fontColor === b.fontColor
    && a.downloadPath === b.downloadPath
    && a.useSystemDownloadPath === b.useSystemDownloadPath
    && a.terminalFontSize === b.terminalFontSize
    && a.terminalFontFamily === b.terminalFontFamily
    && a.terminalPalette === b.terminalPalette
    && a.terminalScrollback === b.terminalScrollback
    && a.terminalPasteConfirmEnabled === b.terminalPasteConfirmEnabled
    && a.terminalPasteConfirmMaxChars === b.terminalPasteConfirmMaxChars
    && a.terminalCommandSuggestEnabled === b.terminalCommandSuggestEnabled
    && a.downloadConflictStrategy === b.downloadConflictStrategy
    && a.dirTransferConcurrency === b.dirTransferConcurrency
    && a.dirTransferFailPolicy === b.dirTransferFailPolicy
    && a.dbFontFamily === b.dbFontFamily
    && a.dbFontSize === b.dbFontSize
    && a.dbPageSize === b.dbPageSize
    && a.dbConfirmDangerousSql === b.dbConfirmDangerousSql
    && a.dbDefaultMaxRows === b.dbDefaultMaxRows
    && a.dbDefaultQueryTimeoutSec === b.dbDefaultQueryTimeoutSec
    && a.dbDefaultRunScope === b.dbDefaultRunScope
    && a.latencyEnabled === b.latencyEnabled
    && a.latencyIntervalSec === b.latencyIntervalSec
    && a.connectionUsageStatsEnabled === b.connectionUsageStatsEnabled
    && a.fancyCursorEnabled === b.fancyCursorEnabled
    && a.fancyCursorStyle === b.fancyCursorStyle
    && a.appBackground.imageUrl === b.appBackground.imageUrl
    && a.appBackground.fit === b.appBackground.fit
    && a.appBackground.overlay === b.appBackground.overlay
    && a.appBackground.fileName === b.appBackground.fileName
    && a.appBackground.token === b.appBackground.token
    && a.appBackground.cleared === b.appBackground.cleared
    && a.monitorEnabled === b.monitorEnabled
    && a.monitorIntervalSec === b.monitorIntervalSec
    && a.autoReconnectEnabled === b.autoReconnectEnabled
    && a.autoReconnectMaxRetries === b.autoReconnectMaxRetries
    && a.workspaceRestoreEnabled === b.workspaceRestoreEnabled
    && a.closeToTrayEnabled === b.closeToTrayEnabled
    && a.globalHotkeyEnabled === b.globalHotkeyEnabled
    && a.sessionLogEnabled === b.sessionLogEnabled
    && a.x11AutoStartEnabled === b.x11AutoStartEnabled
    && a.x11ServerPath === b.x11ServerPath
  )
}

export function useSettingsDraft(): {
  draft: Ref<SettingsDraft>
  saved: Ref<SettingsDraft>
  loading: Ref<boolean>
  saving: Ref<boolean>
  recentDownloadPaths: Ref<string[]>
  systemDefaultDownloadPath: Ref<string>
  isDirty: ComputedRef<boolean>
  loadSettings: () => Promise<void>
  handleSave: () => Promise<void>
  restoreSystemDefaults: () => Promise<void>
  cloneDraft: typeof cloneDraft
  createEmptyDraft: typeof createEmptyDraft
} {
  const { theme, customColors, setTheme, setCustomColors } = useTheme()

  const loading = ref(true)
  const saving = ref(false)
  const recentDownloadPaths = ref<string[]>([])
  /** OS Downloads folder, e.g. C:\\Users\\…\\Downloads */
  const systemDefaultDownloadPath = ref('')

  const draft = ref<SettingsDraft>(createEmptyDraft())
  /** Last loaded / saved snapshot — used for dirty check */
  const saved = ref<SettingsDraft>(createEmptyDraft())

  const isDirty = computed(() => !draftsEqual(draft.value, saved.value))

  function createSystemDefaultDraft(): SettingsDraft {
    return {
      theme: 'dark',
      bgColor: '#0d1117',
      fontColor: '#e6edf3',
      downloadPath: systemDefaultDownloadPath.value,
      useSystemDownloadPath: true,
      terminalFontSize: 14,
      terminalFontFamily: pickInstalledFontFamily(),
      terminalPalette: 'auto',
      terminalScrollback: 5000,
      terminalPasteConfirmEnabled: true,
      terminalPasteConfirmMaxChars: PASTE_CONFIRM_MAX_CHARS,
      terminalCommandSuggestEnabled: false,
      downloadConflictStrategy: 'rename',
      dirTransferConcurrency: 3,
      dirTransferFailPolicy: 'stop',
      dbFontFamily: DEFAULT_DB_FONT_FAMILY,
      dbFontSize: DEFAULT_DB_FONT_SIZE,
      dbPageSize: DEFAULT_DB_PAGE_SIZE,
      dbConfirmDangerousSql: true,
      dbDefaultMaxRows: DEFAULT_DB_DEFAULT_MAX_ROWS,
      dbDefaultQueryTimeoutSec: DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
      dbDefaultRunScope: DEFAULT_DB_DEFAULT_RUN_SCOPE,
      latencyEnabled: true,
      latencyIntervalSec: 10,
      connectionUsageStatsEnabled: true,
      fancyCursorEnabled: false,
      fancyCursorStyle: 'ring',
      appBackground: emptyAppBackgroundState(),
      monitorEnabled: true,
      monitorIntervalSec: 5,
      autoReconnectEnabled: true,
      autoReconnectMaxRetries: 5,
      workspaceRestoreEnabled: false,
      closeToTrayEnabled: false,
      globalHotkeyEnabled: false,
      sessionLogEnabled: false,
      x11AutoStartEnabled: true,
      x11ServerPath: '',
    }
  }

  async function loadSettings() {
    loading.value = true
    try {
      const all = await window.LiteConnect.getAllSettings()
      systemDefaultDownloadPath.value = all.defaultDownloadPath
      const useSystem = !all.configuredDownloadPath
      const allowedPage = (DB_PAGE_SIZE_OPTIONS as readonly number[]).includes(all.dbPageSize)
        ? (all.dbPageSize as DbPageSize)
        : DEFAULT_DB_PAGE_SIZE
      const next: SettingsDraft = {
        theme: theme.value,
        bgColor: customColors.value.bgColor,
        fontColor: customColors.value.fontColor,
        downloadPath: useSystem ? all.defaultDownloadPath : all.downloadPath,
        useSystemDownloadPath: useSystem,
        terminalFontSize: all.terminalFontSize,
        terminalFontFamily: pickInstalledFontFamily(all.terminalFontFamily),
        terminalPalette: (all.terminalPalette as TerminalPaletteId) || 'auto',
        terminalScrollback: Math.max(2000, Math.min(20000, Math.round(all.terminalScrollback) || 5000)),
        terminalPasteConfirmEnabled: all.terminalPasteConfirmEnabled !== false,
        terminalPasteConfirmMaxChars: normalizePasteConfirmMaxChars(all.terminalPasteConfirmMaxChars),
        terminalCommandSuggestEnabled: all.terminalCommandSuggestEnabled === true,
        downloadConflictStrategy:
          all.downloadConflictStrategy === 'overwrite'
          || all.downloadConflictStrategy === 'skip'
          || all.downloadConflictStrategy === 'rename'
            ? all.downloadConflictStrategy
            : 'rename',
        dirTransferConcurrency: Math.max(1, Math.min(8, Math.round(Number(all.dirTransferConcurrency)) || 3)),
        dirTransferFailPolicy: all.dirTransferFailPolicy === 'continue' ? 'continue' : 'stop',
        dbFontFamily: pickInstalledFontFamily(all.dbFontFamily?.trim() || DEFAULT_DB_FONT_FAMILY),
        dbFontSize: Math.max(10, Math.min(24, Math.round(all.dbFontSize) || DEFAULT_DB_FONT_SIZE)),
        dbPageSize: allowedPage,
        dbConfirmDangerousSql: all.dbConfirmDangerousSql !== false,
        dbDefaultMaxRows: clampQueryMaxRows(all.dbDefaultMaxRows),
        dbDefaultQueryTimeoutSec: clampQueryTimeoutSec(all.dbDefaultQueryTimeoutSec),
        dbDefaultRunScope: sanitizeDefaultRunScopePref(all.dbDefaultRunScope),
        latencyEnabled: all.latencyEnabled,
        latencyIntervalSec: all.latencyIntervalMs / 1000,
        connectionUsageStatsEnabled: all.connectionUsageStatsEnabled !== false,
        fancyCursorEnabled: all.fancyCursorEnabled === true,
        fancyCursorStyle: sanitizeFancyCursorStyle(all.fancyCursorStyle),
        appBackground: {
          imageUrl: typeof all.appBackground?.imageUrl === 'string' ? all.appBackground.imageUrl : '',
          fit: sanitizeAppBackgroundFit(all.appBackground?.fit),
          overlay: clampBackgroundOverlay(all.appBackground?.overlay),
          fileName: typeof all.appBackground?.fileName === 'string' ? all.appBackground.fileName : '',
          token: '',
          cleared: false,
        },
        monitorEnabled: all.monitorEnabled,
        monitorIntervalSec: all.monitorIntervalMs / 1000,
        autoReconnectEnabled: all.autoReconnectEnabled,
        autoReconnectMaxRetries: all.autoReconnectMaxRetries,
        workspaceRestoreEnabled: all.workspaceRestoreEnabled === true,
        closeToTrayEnabled: all.closeToTrayEnabled === true,
        globalHotkeyEnabled: all.globalHotkeyEnabled === true,
        sessionLogEnabled: all.sessionLogEnabled === true,
        x11AutoStartEnabled: all.x11AutoStartEnabled !== false,
        x11ServerPath: typeof all.x11ServerPath === 'string' ? all.x11ServerPath : '',
      }
      draft.value = cloneDraft(next)
      saved.value = cloneDraft(next)
      recentDownloadPaths.value = all.recentDownloadPaths || []
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    void loadSettings()
  })

  /** 将草稿恢复为应用出厂默认（需再点保存才写入） */
  async function restoreSystemDefaults() {
    try {
      await appConfirm({
        title: t('settings.restoreTitle'),
        message: t('settings.restoreMessage'),
        detail: t('settings.restoreDetail'),
        confirmText: t('settings.restoreConfirm'),
        tone: 'info',
      })
      const next = createSystemDefaultDraft()
      // Explicit clear so save removes persisted wallpaper
      next.appBackground = { ...emptyAppBackgroundState(), cleared: true }
      draft.value = next
      applyAppBackground({ imageUrl: '' })
      ElMessage.success(t('settings.restoreFilled'))
    } catch {
      // cancelled
    }
  }

  async function handleSave() {
    if (saving.value || loading.value) return
    if (!isDirty.value) {
      ElMessage.info(t('settings.noChanges'))
      return
    }

    saving.value = true
    try {
      const d = draft.value

      if (d.theme === 'custom') {
        setCustomColors({ fontColor: d.fontColor, bgColor: d.bgColor })
      }
      setTheme(d.theme)

      const bg = d.appBackground
      const savedAll = await window.LiteConnect.setManySettings({
        fancyCursorEnabled: d.fancyCursorEnabled,
        fancyCursorStyle: d.fancyCursorStyle,
        appBackground: {
          token: bg.token || undefined,
          clear: bg.cleared,
          fit: bg.fit,
          overlay: bg.overlay,
        },
        downloadPath: d.useSystemDownloadPath ? '' : d.downloadPath,
        terminalFontSize: d.terminalFontSize,
        terminalFontFamily: d.terminalFontFamily,
        terminalPalette: d.terminalPalette,
        terminalScrollback: d.terminalScrollback,
        terminalPasteConfirmEnabled: d.terminalPasteConfirmEnabled,
        terminalPasteConfirmMaxChars: d.terminalPasteConfirmMaxChars,
        terminalCommandSuggestEnabled: d.terminalCommandSuggestEnabled,
        downloadConflictStrategy: d.downloadConflictStrategy,
        dirTransferConcurrency: d.dirTransferConcurrency,
        dirTransferFailPolicy: d.dirTransferFailPolicy,
        dbFontFamily: d.dbFontFamily,
        dbFontSize: d.dbFontSize,
        dbPageSize: d.dbPageSize,
        dbConfirmDangerousSql: d.dbConfirmDangerousSql !== false,
        dbDefaultMaxRows: clampQueryMaxRows(d.dbDefaultMaxRows),
        dbDefaultQueryTimeoutSec: clampQueryTimeoutSec(d.dbDefaultQueryTimeoutSec),
        dbDefaultRunScope: sanitizeDefaultRunScopePref(d.dbDefaultRunScope),
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
        sessionLogEnabled: d.sessionLogEnabled,
        x11AutoStartEnabled: d.x11AutoStartEnabled,
        x11ServerPath: d.x11ServerPath,
      })

      window.dispatchEvent(new CustomEvent('fancy-cursor-settings-change', {
        detail: { enabled: d.fancyCursorEnabled, style: d.fancyCursorStyle },
      }))

      d.appBackground = {
        imageUrl: savedAll.appBackground.imageUrl,
        fit: savedAll.appBackground.fit,
        overlay: savedAll.appBackground.overlay,
        fileName: savedAll.appBackground.fileName,
        token: '',
        cleared: false,
      }
      applyAppBackground({
        imageUrl: d.appBackground.imageUrl,
        fit: d.appBackground.fit as AppBackgroundFit,
        overlay: d.appBackground.overlay,
      })
      window.dispatchEvent(
        new CustomEvent('app-background-settings-change', {
          detail: {
            imageUrl: d.appBackground.imageUrl,
            fit: d.appBackground.fit,
            overlay: d.appBackground.overlay,
          },
        }),
      )

      if (!d.useSystemDownloadPath && d.downloadPath) {
        await window.LiteConnect.addRecentDownloadPath(d.downloadPath)
        recentDownloadPaths.value = await window.LiteConnect.getRecentDownloadPaths()
      }
      d.downloadPath = savedAll.downloadPath
      d.useSystemDownloadPath = !savedAll.configuredDownloadPath

      dispatchDbSettingsChange({
        fontFamily: d.dbFontFamily,
        fontSize: d.dbFontSize,
        pageSize: d.dbPageSize,
        confirmDangerousSql: d.dbConfirmDangerousSql !== false,
        defaultMaxRows: clampQueryMaxRows(d.dbDefaultMaxRows),
        defaultQueryTimeoutSec: clampQueryTimeoutSec(d.dbDefaultQueryTimeoutSec),
        defaultRunScope: sanitizeDefaultRunScopePref(d.dbDefaultRunScope),
      })

      window.dispatchEvent(new CustomEvent('download-conflict-settings-change', {
        detail: { strategy: d.downloadConflictStrategy },
      }))
      window.dispatchEvent(new CustomEvent('dir-transfer-settings-change', {
        detail: {
          concurrency: d.dirTransferConcurrency,
          failPolicy: d.dirTransferFailPolicy,
        },
      }))
      window.dispatchEvent(new CustomEvent('terminal-font-settings-change', {
        detail: { fontSize: d.terminalFontSize, fontFamily: d.terminalFontFamily },
      }))
      window.dispatchEvent(new CustomEvent('terminal-palette-change', {
        detail: { palette: d.terminalPalette },
      }))
      window.dispatchEvent(new CustomEvent('terminal-behavior-settings-change', {
        detail: {
          scrollback: d.terminalScrollback,
          pasteConfirmEnabled: d.terminalPasteConfirmEnabled,
          pasteConfirmMaxChars: d.terminalPasteConfirmMaxChars,
          commandSuggestEnabled: d.terminalCommandSuggestEnabled,
        },
      }))
      window.dispatchEvent(new CustomEvent('latency-settings-change', {
        detail: { enabled: d.latencyEnabled, intervalMs: d.latencyIntervalSec * 1000 },
      }))
      window.dispatchEvent(new CustomEvent('connection-usage-stats-settings-change', {
        detail: { enabled: d.connectionUsageStatsEnabled },
      }))
      window.dispatchEvent(new CustomEvent('workspace-restore-settings-change', {
        detail: { enabled: d.workspaceRestoreEnabled },
      }))
      window.dispatchEvent(new CustomEvent('monitor-settings-change', {
        detail: { enabled: d.monitorEnabled, intervalMs: d.monitorIntervalSec * 1000 },
      }))

      saved.value = cloneDraft(d)
      draft.value = cloneDraft(d)
      ElMessage.success(t('settings.saved'))
    } catch (err: any) {
      ElMessage.error(err?.message || t('settings.saveFailed'))
    } finally {
      saving.value = false
    }
  }

  return {
    draft,
    saved,
    loading,
    saving,
    recentDownloadPaths,
    systemDefaultDownloadPath,
    isDirty,
    loadSettings,
    handleSave,
    restoreSystemDefaults,
    cloneDraft,
    createEmptyDraft,
  }
}
