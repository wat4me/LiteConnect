import { onMounted, onBeforeUnmount, ref } from 'vue'
import { terminalFontFamilyPresets } from './useTheme'
import {
  clampQueryMaxRows,
  clampQueryTimeoutSec,
  QUERY_MAX_ROWS_DEFAULT,
  QUERY_TIMEOUT_SEC_DEFAULT,
  sanitizeDefaultRunScopePref,
  type QueryDefaultRunScopePref,
  type QueryTabExecOptions,
} from '../utils/queryTabOptions'

export const DB_PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const
export type DbPageSize = (typeof DB_PAGE_SIZE_OPTIONS)[number]

export const DEFAULT_DB_FONT_FAMILY = terminalFontFamilyPresets[0].value
export const DEFAULT_DB_FONT_SIZE = 13
export const DEFAULT_DB_PAGE_SIZE: DbPageSize = 100

export const DEFAULT_DB_DEFAULT_MAX_ROWS = QUERY_MAX_ROWS_DEFAULT
export const DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC = QUERY_TIMEOUT_SEC_DEFAULT
export const DEFAULT_DB_DEFAULT_RUN_SCOPE: QueryDefaultRunScopePref = 'smart'

export interface DbSettingsSnapshot {
  fontFamily: string
  fontSize: number
  pageSize: DbPageSize
  confirmDangerousSql: boolean
  /** Global default max rows for new query tabs (1..100000). */
  defaultMaxRows: number
  /** Global default query timeout for new query tabs (seconds, 1..600). */
  defaultQueryTimeoutSec: number
  /** Global default run scope for new query tabs. */
  defaultRunScope: QueryDefaultRunScopePref
}

const EVENT_NAME = 'db-settings-change'

/** Module-level cache so DatabaseView can open tabs with latest defaults without re-fetch. */
const cached = ref<DbSettingsSnapshot>({
  fontFamily: DEFAULT_DB_FONT_FAMILY,
  fontSize: DEFAULT_DB_FONT_SIZE,
  pageSize: DEFAULT_DB_PAGE_SIZE,
  confirmDangerousSql: true,
  defaultMaxRows: DEFAULT_DB_DEFAULT_MAX_ROWS,
  defaultQueryTimeoutSec: DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
  defaultRunScope: DEFAULT_DB_DEFAULT_RUN_SCOPE,
})

function clampFontSize(n: number): number {
  return Math.max(10, Math.min(24, Math.round(n)))
}

function normalizePageSize(n: number): DbPageSize {
  return (DB_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as DbPageSize)
    : DEFAULT_DB_PAGE_SIZE
}

function normalizeSnapshot(partial: {
  fontFamily?: string
  fontSize?: number
  pageSize?: number
  confirmDangerousSql?: boolean
  defaultMaxRows?: number
  defaultQueryTimeoutSec?: number
  defaultRunScope?: QueryDefaultRunScopePref | string
}): DbSettingsSnapshot {
  return {
    fontFamily: partial.fontFamily?.trim() || DEFAULT_DB_FONT_FAMILY,
    fontSize: clampFontSize(typeof partial.fontSize === 'number' ? partial.fontSize : DEFAULT_DB_FONT_SIZE),
    pageSize: normalizePageSize(typeof partial.pageSize === 'number' ? partial.pageSize : DEFAULT_DB_PAGE_SIZE),
    confirmDangerousSql: partial.confirmDangerousSql !== false,
    defaultMaxRows: clampQueryMaxRows(
      partial.defaultMaxRows !== undefined ? partial.defaultMaxRows : DEFAULT_DB_DEFAULT_MAX_ROWS,
    ),
    defaultQueryTimeoutSec: clampQueryTimeoutSec(
      partial.defaultQueryTimeoutSec !== undefined
        ? partial.defaultQueryTimeoutSec
        : DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC,
    ),
    defaultRunScope: sanitizeDefaultRunScopePref(
      partial.defaultRunScope !== undefined ? partial.defaultRunScope : DEFAULT_DB_DEFAULT_RUN_SCOPE,
    ),
  }
}

export function getCachedDbSettings(): DbSettingsSnapshot {
  return { ...cached.value }
}

/** Query-tab exec defaults from live cache (maxRows + timeoutMs + run scope). */
export function getCachedQueryTabDefaults(): QueryTabExecOptions {
  const s = cached.value
  return {
    maxRows: clampQueryMaxRows(s.defaultMaxRows),
    timeoutMs: clampQueryTimeoutSec(s.defaultQueryTimeoutSec) * 1000,
    defaultRunScope: sanitizeDefaultRunScopePref(s.defaultRunScope),
  }
}

export function applyDbSettingsToElement(el: HTMLElement | null, settings: DbSettingsSnapshot) {
  if (!el) return
  const size = clampFontSize(settings.fontSize)
  el.style.setProperty('--font-mono', settings.fontFamily)
  el.style.setProperty('--db-font-family', settings.fontFamily)
  el.style.setProperty('--db-font-size', `${size}px`)
  el.style.setProperty('--font-ui', `${size}px`)
  el.style.setProperty('--font-ui-sm', `${Math.max(10, size - 1)}px`)
}

export function dispatchDbSettingsChange(settings: DbSettingsSnapshot) {
  cached.value = normalizeSnapshot(settings)
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...cached.value } }))
}

export async function loadDbSettings(): Promise<DbSettingsSnapshot> {
  const [
    fontFamily,
    fontSize,
    pageSize,
    confirmDangerousSql,
    defaultMaxRows,
    defaultQueryTimeoutSec,
    defaultRunScope,
  ] = await Promise.all([
    window.LiteConnect.getDbFontFamily(),
    window.LiteConnect.getDbFontSize(),
    window.LiteConnect.getDbPageSize(),
    window.LiteConnect.getDbConfirmDangerousSql().catch(() => true),
    window.LiteConnect.getDbDefaultMaxRows().catch(() => DEFAULT_DB_DEFAULT_MAX_ROWS),
    window.LiteConnect.getDbDefaultQueryTimeoutSec().catch(() => DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC),
    window.LiteConnect.getDbDefaultRunScope().catch(() => DEFAULT_DB_DEFAULT_RUN_SCOPE),
  ])
  const next = normalizeSnapshot({
    fontFamily: fontFamily?.trim() || DEFAULT_DB_FONT_FAMILY,
    fontSize,
    pageSize,
    confirmDangerousSql: confirmDangerousSql !== false,
    defaultMaxRows,
    defaultQueryTimeoutSec,
    defaultRunScope,
  })
  cached.value = next
  return { ...next }
}

export async function saveDbSettings(settings: DbSettingsSnapshot): Promise<DbSettingsSnapshot> {
  const next = normalizeSnapshot(settings)
  await Promise.all([
    window.LiteConnect.setDbFontFamily(next.fontFamily),
    window.LiteConnect.setDbFontSize(next.fontSize),
    window.LiteConnect.setDbPageSize(next.pageSize),
    window.LiteConnect.setDbConfirmDangerousSql(next.confirmDangerousSql),
    window.LiteConnect.setDbDefaultMaxRows(next.defaultMaxRows),
    window.LiteConnect.setDbDefaultQueryTimeoutSec(next.defaultQueryTimeoutSec),
    window.LiteConnect.setDbDefaultRunScope(next.defaultRunScope),
  ])
  dispatchDbSettingsChange(next)
  return next
}

/**
 * Bind database workspace root to persisted DB typography settings.
 * Call from DatabaseView; returns reactive snapshot + teardown.
 * Note: query-tab defaults update the cache/event only; open tabs are not rewritten.
 */
export function useDbSettings(rootEl: () => HTMLElement | null) {
  const settings = ref<DbSettingsSnapshot>(getCachedDbSettings())

  function apply(next: DbSettingsSnapshot) {
    settings.value = next
    applyDbSettingsToElement(rootEl(), next)
  }

  function onChange(ev: Event) {
    const detail = (ev as CustomEvent<DbSettingsSnapshot>).detail
    if (!detail) return
    apply(normalizeSnapshot(detail))
  }

  onMounted(() => {
    void loadDbSettings().then((next) => apply(next))
    window.addEventListener(EVENT_NAME, onChange)
  })

  onBeforeUnmount(() => {
    window.removeEventListener(EVENT_NAME, onChange)
  })

  return { settings, reload: () => loadDbSettings().then(apply) }
}
