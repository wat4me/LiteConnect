import { computed, onMounted, onBeforeUnmount, ref, type Ref, type ComputedRef } from 'vue'
import type { AppSettingsAll } from '@shared/types/settings'
import { buildSettingsDraftPatch } from './settingsDraftPatch'
import { ElMessage } from 'element-plus/es/components/message/index'
import { getStoredLocale, t } from '@/i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  useTheme,
  pickInstalledFontFamily,
  type TerminalPaletteId,
  type Theme,
} from '@/composables/app/useTheme'
import { applyAppSettings } from './applyAppSettings'
import { rebaseSettingsDraft } from './rebaseSettingsDraft'
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
  type AppBackgroundState,
} from '@/composables/app/useAppBackground'
import {
  DEFAULT_DB_OPEN_MODE,
  sanitizeDbOpenMode,
  type DbOpenMode,
} from '@shared/dbOpenMode'
import {
  DEFAULT_GLOBAL_HOTKEY,
  normalizeGlobalHotkey,
} from '@shared/globalHotkey'
import { DEFAULT_SFTP_FONT_SIZE, sanitizeSftpFontSize } from '@shared/sftpFontSize'
import { DEFAULT_APP_LOCALE, sanitizeAppLocale, type AppLocale } from '@shared/appLocale'

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
  terminalLocalEchoEnabled: boolean
  /** Newline-separated, case-insensitive shell glob exclusions. */
  terminalCommandHistoryExcludePatterns: string
  downloadConflictStrategy: 'overwrite' | 'skip' | 'rename'
  dirTransferConcurrency: number
  dirTransferFailPolicy: 'continue' | 'stop'
  sftpFontSize: number
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
  /** Detached SSH window → DB; the main window always switches in place. */
  dbOpenMode: DbOpenMode
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
  /** Interface language. Saved with the rest of the draft. */
  locale: AppLocale
  /** Global hotkey to show/hide the window. Default off. */
  globalHotkeyEnabled: boolean
  /** Electron accelerator for the global hotkey; user-customizable. */
  globalHotkey: string
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
    terminalLocalEchoEnabled: false,
    terminalCommandHistoryExcludePatterns: '',
    downloadConflictStrategy: 'rename',
    dirTransferConcurrency: 3,
    dirTransferFailPolicy: 'stop',
    sftpFontSize: DEFAULT_SFTP_FONT_SIZE,
    dbFontFamily: DEFAULT_DB_FONT_FAMILY,
    dbFontSize: DEFAULT_DB_FONT_SIZE,
    dbPageSize: DEFAULT_DB_PAGE_SIZE,
    dbConfirmDangerousSql: true,
    dbDefaultMaxRows: DEFAULT_DB_DEFAULT_MAX_ROWS,
    dbDefaultQueryTimeoutSec: DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
    dbDefaultRunScope: DEFAULT_DB_DEFAULT_RUN_SCOPE,
    dbOpenMode: DEFAULT_DB_OPEN_MODE,
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
    globalHotkey: DEFAULT_GLOBAL_HOTKEY,
    sessionLogEnabled: false,
    x11AutoStartEnabled: true,
    x11ServerPath: '',
    locale: DEFAULT_APP_LOCALE,
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
    && a.terminalLocalEchoEnabled === b.terminalLocalEchoEnabled
    && a.terminalCommandHistoryExcludePatterns === b.terminalCommandHistoryExcludePatterns
    && a.downloadConflictStrategy === b.downloadConflictStrategy
    && a.dirTransferConcurrency === b.dirTransferConcurrency
    && a.dirTransferFailPolicy === b.dirTransferFailPolicy
    && a.sftpFontSize === b.sftpFontSize
    && a.dbFontFamily === b.dbFontFamily
    && a.dbFontSize === b.dbFontSize
    && a.dbPageSize === b.dbPageSize
    && a.dbConfirmDangerousSql === b.dbConfirmDangerousSql
    && a.dbDefaultMaxRows === b.dbDefaultMaxRows
    && a.dbDefaultQueryTimeoutSec === b.dbDefaultQueryTimeoutSec
    && a.dbDefaultRunScope === b.dbDefaultRunScope
    && a.dbOpenMode === b.dbOpenMode
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
    && a.globalHotkey === b.globalHotkey
    && a.sessionLogEnabled === b.sessionLogEnabled
    && a.x11AutoStartEnabled === b.x11AutoStartEnabled
    && a.x11ServerPath === b.x11ServerPath
    && a.locale === b.locale
  )
}

export function useSettingsDraft(): {
  draft: Ref<SettingsDraft>
  saved: Ref<SettingsDraft>
  loading: Ref<boolean>
  loadError: Ref<string>
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
  const { theme, customColors } = useTheme()

  const loading = ref(true)
  const loadError = ref('')
  let loaded = false
  let loadInFlight = false
  let pendingSettings: AppSettingsAll | undefined
  const saving = ref(false)
  const resetAllRequested = ref(false)
  const recentDownloadPaths = ref<string[]>([])
  /** OS Downloads folder, e.g. C:\\Users\\…\\Downloads */
  const systemDefaultDownloadPath = ref('')

  const draft = ref<SettingsDraft>(createEmptyDraft())
  /** Last loaded / saved snapshot — used for dirty check */
  const saved = ref<SettingsDraft>(createEmptyDraft())

  const isDirty = computed(() => resetAllRequested.value || !draftsEqual(draft.value, saved.value))

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
      terminalLocalEchoEnabled: false,
      terminalCommandHistoryExcludePatterns: '',
      downloadConflictStrategy: 'rename',
      dirTransferConcurrency: 3,
      dirTransferFailPolicy: 'stop',
      sftpFontSize: DEFAULT_SFTP_FONT_SIZE,
      dbFontFamily: DEFAULT_DB_FONT_FAMILY,
      dbFontSize: DEFAULT_DB_FONT_SIZE,
      dbPageSize: DEFAULT_DB_PAGE_SIZE,
      dbConfirmDangerousSql: true,
      dbDefaultMaxRows: DEFAULT_DB_DEFAULT_MAX_ROWS,
      dbDefaultQueryTimeoutSec: DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
      dbDefaultRunScope: DEFAULT_DB_DEFAULT_RUN_SCOPE,
      dbOpenMode: DEFAULT_DB_OPEN_MODE,
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
      globalHotkey: DEFAULT_GLOBAL_HOTKEY,
      sessionLogEnabled: false,
      x11AutoStartEnabled: true,
      x11ServerPath: '',
      locale: DEFAULT_APP_LOCALE,
    }
  }

  function fromPersistedSettings(all: AppSettingsAll): SettingsDraft {
    const useSystem = !all.configuredDownloadPath
    const allowedPage = (DB_PAGE_SIZE_OPTIONS as readonly number[]).includes(all.dbPageSize)
      ? (all.dbPageSize as DbPageSize)
      : DEFAULT_DB_PAGE_SIZE
    const next: SettingsDraft = {
      theme: (['dark', 'light', 'eyecare', 'custom'].includes(all.theme) ? all.theme : theme.value) as Theme,
      bgColor: all.customColors?.bgColor || customColors.value.bgColor,
      fontColor: all.customColors?.fontColor || customColors.value.fontColor,
      downloadPath: useSystem ? all.defaultDownloadPath : all.downloadPath,
      useSystemDownloadPath: useSystem,
      terminalFontSize: all.terminalFontSize,
      terminalFontFamily: pickInstalledFontFamily(all.terminalFontFamily),
      terminalPalette: (all.terminalPalette as TerminalPaletteId) || 'auto',
      terminalScrollback: Math.max(2000, Math.min(20000, Math.round(all.terminalScrollback) || 5000)),
      terminalPasteConfirmEnabled: all.terminalPasteConfirmEnabled !== false,
      terminalPasteConfirmMaxChars: normalizePasteConfirmMaxChars(all.terminalPasteConfirmMaxChars),
      terminalCommandSuggestEnabled: all.terminalCommandSuggestEnabled === true,
      terminalLocalEchoEnabled: all.terminalLocalEchoEnabled === true,
      terminalCommandHistoryExcludePatterns: Array.isArray(all.terminalCommandHistoryExcludePatterns)
        ? all.terminalCommandHistoryExcludePatterns.join('\n')
        : '',
      downloadConflictStrategy:
        all.downloadConflictStrategy === 'overwrite'
        || all.downloadConflictStrategy === 'skip'
        || all.downloadConflictStrategy === 'rename'
          ? all.downloadConflictStrategy
          : 'rename',
      dirTransferConcurrency: Math.max(1, Math.min(8, Math.round(Number(all.dirTransferConcurrency)) || 3)),
      dirTransferFailPolicy: all.dirTransferFailPolicy === 'continue' ? 'continue' : 'stop',
      sftpFontSize: sanitizeSftpFontSize(all.sftpFontSize),
      dbFontFamily: pickInstalledFontFamily(all.dbFontFamily?.trim() || DEFAULT_DB_FONT_FAMILY),
      dbFontSize: Math.max(10, Math.min(24, Math.round(all.dbFontSize) || DEFAULT_DB_FONT_SIZE)),
      dbPageSize: allowedPage,
      dbConfirmDangerousSql: all.dbConfirmDangerousSql !== false,
      dbDefaultMaxRows: clampQueryMaxRows(all.dbDefaultMaxRows),
      dbDefaultQueryTimeoutSec: clampQueryTimeoutSec(all.dbDefaultQueryTimeoutSec),
      dbDefaultRunScope: sanitizeDefaultRunScopePref(all.dbDefaultRunScope),
      dbOpenMode: sanitizeDbOpenMode(all.dbOpenMode),
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
      globalHotkey: normalizeGlobalHotkey(all.globalHotkey) ?? DEFAULT_GLOBAL_HOTKEY,
      sessionLogEnabled: all.sessionLogEnabled === true,
      x11AutoStartEnabled: all.x11AutoStartEnabled !== false,
      x11ServerPath: typeof all.x11ServerPath === 'string' ? all.x11ServerPath : '',
      locale: sanitizeAppLocale(all.localeConfigured ? all.locale : getStoredLocale()),
    }
    return next
  }

  async function loadSettings() {
    if (saving.value || loadInFlight) return
    loadInFlight = true
    pendingSettings = undefined
    loading.value = true
    loadError.value = ''
    loaded = false
    try {
      const fetched = await window.LiteConnect.getAllSettings()
      const all = pendingSettings || fetched
      pendingSettings = undefined
      systemDefaultDownloadPath.value = all.defaultDownloadPath
      const next = fromPersistedSettings(all)
      resetAllRequested.value = false
      draft.value = cloneDraft(next)
      saved.value = cloneDraft(next)
      recentDownloadPaths.value = all.recentDownloadPaths || []
      loaded = true
    } catch (error) {
      loadError.value = error instanceof Error && error.message ? error.message : t('settings.loadFailed')
    } finally {
      loading.value = false
      loadInFlight = false
    }
  }

  let unsubscribeSettings: (() => void) | undefined
  onMounted(() => {
    unsubscribeSettings = window.LiteConnect.onSettingsChanged?.(({ settings }) => {
      if (loading.value) { pendingSettings = settings; return }
      if (!loaded || loadError.value) return
      const incoming = fromPersistedSettings(settings)
      if (!resetAllRequested.value) {
        draft.value = rebaseSettingsDraft(draft.value, saved.value, incoming)
        if (draft.value.useSystemDownloadPath) draft.value.downloadPath = settings.defaultDownloadPath
      }
      saved.value = cloneDraft(incoming)
      recentDownloadPaths.value = settings.recentDownloadPaths || []
      systemDefaultDownloadPath.value = settings.defaultDownloadPath
    })
    void loadSettings()
  })
  onBeforeUnmount(() => unsubscribeSettings?.())

  /** 将草稿恢复为应用出厂默认（需再点保存才写入） */
  async function restoreSystemDefaults() {
    if (!loaded || loading.value || saving.value) return
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
      resetAllRequested.value = true
      applyAppBackground({ imageUrl: '' })
      ElMessage.success(t('settings.restoreFilled'))
    } catch {
      // cancelled
    }
  }

  async function handleSave() {
    if (!loaded || saving.value || loading.value) return
    if (!isDirty.value) {
      ElMessage.info(t('settings.noChanges'))
      return
    }

    saving.value = true
    try {
      const submitted = cloneDraft(draft.value)
      const patch = buildSettingsDraftPatch(submitted, saved.value, { resetAll: resetAllRequested.value })
      if (Object.keys(patch).length === 0) {
        saved.value = cloneDraft(submitted)
        ElMessage.info(t('settings.noChanges'))
        return
      }
      const savedAll = await window.LiteConnect.setManySettings(patch)
      resetAllRequested.value = false
      const d = fromPersistedSettings(savedAll)
      applyAppSettings(savedAll)

      recentDownloadPaths.value = savedAll.recentDownloadPaths || []
      if (patch.downloadPath !== undefined && !d.useSystemDownloadPath && d.downloadPath) {
        try {
          await window.LiteConnect.addRecentDownloadPath(d.downloadPath)
          recentDownloadPaths.value = await window.LiteConnect.getRecentDownloadPaths()
        } catch { /* The settings are committed; a recent-path failure must not report a failed save. */ }
      }
      d.downloadPath = savedAll.downloadPath
      d.useSystemDownloadPath = !savedAll.configuredDownloadPath

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
    loadError,
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
