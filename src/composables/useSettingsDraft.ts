import { computed, onMounted, ref, type Ref, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '../i18n'
import { appConfirm } from './useAppDialog'
import {
  useTheme,
  terminalFontFamilyPresets,
  type TerminalPaletteId,
  type Theme,
} from './useTheme'
import {
  DB_PAGE_SIZE_OPTIONS,
  DEFAULT_DB_DEFAULT_MAX_ROWS,
  DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
  DEFAULT_DB_DEFAULT_RUN_SCOPE,
  DEFAULT_DB_FONT_FAMILY,
  DEFAULT_DB_FONT_SIZE,
  DEFAULT_DB_PAGE_SIZE,
  saveDbSettings,
  type DbPageSize,
} from './useDbSettings'
import {
  clampQueryMaxRows,
  clampQueryTimeoutSec,
  sanitizeDefaultRunScopePref,
  type QueryDefaultRunScopePref,
} from '../utils/queryTabOptions'
import {
  PASTE_CONFIRM_MAX_CHARS,
  normalizePasteConfirmMaxChars,
  type PasteConfirmMaxChars,
} from '../utils/terminalPaste'

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
  monitorEnabled: boolean
  monitorIntervalSec: number
  autoReconnectEnabled: boolean
  autoReconnectMaxRetries: number
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
    terminalFontFamily: terminalFontFamilyPresets[0].value,
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
    monitorEnabled: true,
    monitorIntervalSec: 5,
    autoReconnectEnabled: true,
    autoReconnectMaxRetries: 5,
    x11AutoStartEnabled: true,
    x11ServerPath: '',
  }
}

export function cloneDraft(d: SettingsDraft): SettingsDraft {
  return { ...d }
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
    && a.monitorEnabled === b.monitorEnabled
    && a.monitorIntervalSec === b.monitorIntervalSec
    && a.autoReconnectEnabled === b.autoReconnectEnabled
    && a.autoReconnectMaxRetries === b.autoReconnectMaxRetries
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
      terminalFontFamily: terminalFontFamilyPresets[0].value,
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
      monitorEnabled: true,
      monitorIntervalSec: 5,
      autoReconnectEnabled: true,
      autoReconnectMaxRetries: 5,
      x11AutoStartEnabled: true,
      x11ServerPath: '',
    }
  }

  async function loadSettings() {
    loading.value = true
    try {
      const [
        configuredDownloadPath,
        defaultDownloadPath,
        resolvedDownloadPath,
        nextTerminalFontSize,
        nextTerminalFontFamily,
        nextTerminalPalette,
        nextTerminalScrollback,
        nextTerminalPasteConfirm,
        nextTerminalPasteMaxChars,
        nextTerminalCommandSuggest,
        nextDownloadConflict,
        nextDirConcurrency,
        nextDirFailPolicy,
        nextDbFontFamily,
        nextDbFontSize,
        nextDbPageSize,
        nextDbConfirmDangerousSql,
        nextDbDefaultMaxRows,
        nextDbDefaultQueryTimeoutSec,
        nextDbDefaultRunScope,
        nextRecentDownloadPaths,
        nextLatencyEnabled,
        nextLatencyIntervalMs,
        nextMonitorEnabled,
        nextMonitorIntervalMs,
        nextAutoReconnect,
        nextAutoReconnectMax,
        nextX11AutoStart,
        nextX11ServerPath,
      ] = await Promise.all([
        window.LiteConnect.getConfiguredDownloadPath(),
        window.LiteConnect.getDefaultDownloadPath(),
        window.LiteConnect.getDownloadPath(),
        window.LiteConnect.getTerminalFontSize(),
        window.LiteConnect.getTerminalFontFamily(),
        window.LiteConnect.getTerminalPalette(),
        window.LiteConnect.getTerminalScrollback(),
        window.LiteConnect.getTerminalPasteConfirmEnabled(),
        window.LiteConnect.getTerminalPasteConfirmMaxChars().catch(() => PASTE_CONFIRM_MAX_CHARS),
        window.LiteConnect.getTerminalCommandSuggestEnabled().catch(() => false),
        window.LiteConnect.getDownloadConflictStrategy(),
        window.LiteConnect.getDirTransferConcurrency().catch(() => 3),
        window.LiteConnect.getDirTransferFailPolicy().catch(() => 'stop' as const),
        window.LiteConnect.getDbFontFamily(),
        window.LiteConnect.getDbFontSize(),
        window.LiteConnect.getDbPageSize(),
        window.LiteConnect.getDbConfirmDangerousSql().catch(() => true),
        window.LiteConnect.getDbDefaultMaxRows().catch(() => DEFAULT_DB_DEFAULT_MAX_ROWS),
        window.LiteConnect.getDbDefaultQueryTimeoutSec().catch(() => DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC),
        window.LiteConnect.getDbDefaultRunScope().catch(() => DEFAULT_DB_DEFAULT_RUN_SCOPE),
        window.LiteConnect.getRecentDownloadPaths(),
        window.LiteConnect.getLatencyEnabled(),
        window.LiteConnect.getLatencyIntervalMs(),
        window.LiteConnect.getMonitorEnabled(),
        window.LiteConnect.getMonitorIntervalMs(),
        window.LiteConnect.getAutoReconnectEnabled(),
        window.LiteConnect.getAutoReconnectMaxRetries(),
        window.LiteConnect.getX11AutoStartEnabled(),
        window.LiteConnect.getX11ServerPath(),
      ])

      systemDefaultDownloadPath.value = defaultDownloadPath
      const useSystem = !configuredDownloadPath
      const allowedPage = (DB_PAGE_SIZE_OPTIONS as readonly number[]).includes(nextDbPageSize)
        ? (nextDbPageSize as DbPageSize)
        : DEFAULT_DB_PAGE_SIZE
      const next: SettingsDraft = {
        theme: theme.value,
        bgColor: customColors.value.bgColor,
        fontColor: customColors.value.fontColor,
        downloadPath: useSystem ? defaultDownloadPath : resolvedDownloadPath,
        useSystemDownloadPath: useSystem,
        terminalFontSize: nextTerminalFontSize,
        terminalFontFamily: nextTerminalFontFamily,
        terminalPalette: (nextTerminalPalette as TerminalPaletteId) || 'auto',
        terminalScrollback: Math.max(2000, Math.min(20000, Math.round(nextTerminalScrollback) || 5000)),
        terminalPasteConfirmEnabled: nextTerminalPasteConfirm !== false,
        terminalPasteConfirmMaxChars: normalizePasteConfirmMaxChars(nextTerminalPasteMaxChars),
        terminalCommandSuggestEnabled: nextTerminalCommandSuggest === true,
        downloadConflictStrategy:
          nextDownloadConflict === 'overwrite' || nextDownloadConflict === 'skip' || nextDownloadConflict === 'rename'
            ? nextDownloadConflict
            : 'rename',
        dirTransferConcurrency: Math.max(1, Math.min(8, Math.round(Number(nextDirConcurrency)) || 3)),
        dirTransferFailPolicy: nextDirFailPolicy === 'continue' ? 'continue' : 'stop',
        dbFontFamily: nextDbFontFamily?.trim() || DEFAULT_DB_FONT_FAMILY,
        dbFontSize: Math.max(10, Math.min(24, Math.round(nextDbFontSize) || DEFAULT_DB_FONT_SIZE)),
        dbPageSize: allowedPage,
        dbConfirmDangerousSql: nextDbConfirmDangerousSql !== false,
        dbDefaultMaxRows: clampQueryMaxRows(nextDbDefaultMaxRows),
        dbDefaultQueryTimeoutSec: clampQueryTimeoutSec(nextDbDefaultQueryTimeoutSec),
        dbDefaultRunScope: sanitizeDefaultRunScopePref(nextDbDefaultRunScope),
        latencyEnabled: nextLatencyEnabled,
        latencyIntervalSec: nextLatencyIntervalMs / 1000,
        monitorEnabled: nextMonitorEnabled,
        monitorIntervalSec: nextMonitorIntervalMs / 1000,
        autoReconnectEnabled: nextAutoReconnect,
        autoReconnectMaxRetries: nextAutoReconnectMax,
        x11AutoStartEnabled: nextX11AutoStart !== false,
        x11ServerPath: typeof nextX11ServerPath === 'string' ? nextX11ServerPath : '',
      }
      draft.value = cloneDraft(next)
      saved.value = cloneDraft(next)
      recentDownloadPaths.value = nextRecentDownloadPaths
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
      draft.value = createSystemDefaultDraft()
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

      // Appearance
      if (d.theme === 'custom') {
        setCustomColors({ fontColor: d.fontColor, bgColor: d.bgColor })
      }
      setTheme(d.theme)

      // Download path: empty string → store uses OS Downloads
      const pathToSave = d.useSystemDownloadPath ? '' : d.downloadPath
      await window.LiteConnect.setDownloadPath(pathToSave)
      if (!d.useSystemDownloadPath && d.downloadPath) {
        await window.LiteConnect.addRecentDownloadPath(d.downloadPath)
        recentDownloadPaths.value = await window.LiteConnect.getRecentDownloadPaths()
      }
      const resolved = await window.LiteConnect.getDownloadPath()
      const configured = await window.LiteConnect.getConfiguredDownloadPath()
      d.downloadPath = resolved
      d.useSystemDownloadPath = !configured

      // Terminal
      await window.LiteConnect.setTerminalFontSize(d.terminalFontSize)
      await window.LiteConnect.setTerminalFontFamily(d.terminalFontFamily)
      await window.LiteConnect.setTerminalPalette(d.terminalPalette)
      await window.LiteConnect.setTerminalScrollback(d.terminalScrollback)
      await window.LiteConnect.setTerminalPasteConfirmEnabled(d.terminalPasteConfirmEnabled)
      await window.LiteConnect.setTerminalPasteConfirmMaxChars(d.terminalPasteConfirmMaxChars)
      await window.LiteConnect.setTerminalCommandSuggestEnabled(d.terminalCommandSuggestEnabled)
      await window.LiteConnect.setDownloadConflictStrategy(d.downloadConflictStrategy)
      await window.LiteConnect.setDirTransferConcurrency(d.dirTransferConcurrency)
      await window.LiteConnect.setDirTransferFailPolicy(d.dirTransferFailPolicy)
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

      // Database client (independent of terminal font)
      await saveDbSettings({
        fontFamily: d.dbFontFamily,
        fontSize: d.dbFontSize,
        pageSize: d.dbPageSize,
        confirmDangerousSql: d.dbConfirmDangerousSql !== false,
        defaultMaxRows: clampQueryMaxRows(d.dbDefaultMaxRows),
        defaultQueryTimeoutSec: clampQueryTimeoutSec(d.dbDefaultQueryTimeoutSec),
        defaultRunScope: sanitizeDefaultRunScopePref(d.dbDefaultRunScope),
      })

      // Network
      await window.LiteConnect.setLatencyEnabled(d.latencyEnabled)
      await window.LiteConnect.setLatencyIntervalMs(d.latencyIntervalSec * 1000)
      window.dispatchEvent(new CustomEvent('latency-settings-change', {
        detail: { enabled: d.latencyEnabled, intervalMs: d.latencyIntervalSec * 1000 },
      }))
      await window.LiteConnect.setMonitorEnabled(d.monitorEnabled)
      await window.LiteConnect.setMonitorIntervalMs(d.monitorIntervalSec * 1000)
      window.dispatchEvent(new CustomEvent('monitor-settings-change', {
        detail: { enabled: d.monitorEnabled, intervalMs: d.monitorIntervalSec * 1000 },
      }))

      await window.LiteConnect.setAutoReconnectEnabled(d.autoReconnectEnabled)
      await window.LiteConnect.setAutoReconnectMaxRetries(d.autoReconnectMaxRetries)
      await window.LiteConnect.setX11AutoStartEnabled(d.x11AutoStartEnabled)
      await window.LiteConnect.setX11ServerPath(d.x11ServerPath)

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
