import type { Ref } from 'vue'
import type { DbConnection, DbSessionInfo } from '../../env.d'
import type { QueryTab, WsTab } from '../../components/database/types'
import { t } from '../../i18n'
import { getCachedQueryTabDefaults } from '../useDbSettings'
import {
  applyQueryTabRename,
  canRestoreDraft,
  draftsForConnection,
  isQueryTabDirty,
  parseQueryDraftFile,
  pruneOrphanDrafts,
  QUERY_DRAFT_DEBOUNCE_MS,
  QUERY_DRAFT_STORAGE_KEY,
  removeDraft,
  removeDraftsForConnection,
  resolveQueryTabTitle,
  serializeQueryDraftFile,
  tabToDraftRecord,
  upsertDraft,
  type QueryDraftRecord,
} from '../../utils/queryDrafts'
import { resolveQueryTabExecOptionsFromDefaults } from '../../utils/queryTabOptions'

export type DbQueryDraftsDeps = {
  tabs: Ref<WsTab[]>
  activeTabId: Ref<string | null>
  connections: Ref<DbConnection[]>
  liveSessions: Ref<Record<string, DbSessionInfo>>
}

export function useDbQueryDrafts(deps: DbQueryDraftsDeps) {
  let draftRecords: QueryDraftRecord[] = []
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
  const restoredDraftIds = new Set<string>()

  function loadDraftsFromStorage() {
    try {
      const raw = localStorage.getItem(QUERY_DRAFT_STORAGE_KEY)
      draftRecords = parseQueryDraftFile(raw).drafts
    } catch {
      draftRecords = []
    }
  }

  function writeDraftsToStorage() {
    try {
      const known = new Set(deps.connections.value.map((c) => c.id))
      draftRecords = pruneOrphanDrafts(draftRecords, known)
      localStorage.setItem(
        QUERY_DRAFT_STORAGE_KEY,
        serializeQueryDraftFile({ version: 1, drafts: draftRecords }),
      )
    } catch {
      // storage full / private mode — ignore
    }
  }

  function scheduleDraftSave() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null
      syncOpenQueryTabsToDrafts()
      writeDraftsToStorage()
    }, QUERY_DRAFT_DEBOUNCE_MS)
  }

  function flushDraftsNow() {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer)
      draftSaveTimer = null
    }
    syncOpenQueryTabsToDrafts()
    writeDraftsToStorage()
  }

  function syncOpenQueryTabsToDrafts() {
    for (const tab of deps.tabs.value) {
      if (tab.kind !== 'query') continue
      const rec = tabToDraftRecord({
        tabId: tab.id,
        connectionId: tab.connectionId,
        database: tab.database,
        title: tab.title,
        titleCustomized: !!tab.titleCustomized,
        sql: tab.sql,
        readOnly: !!tab.readOnly,
        maxRows: tab.maxRows,
        timeoutMs: tab.timeoutMs,
        defaultRunScope: tab.defaultRunScope,
        savedQueryId: tab.savedQueryId,
      })
      if (!rec || !rec.sql.trim()) {
        draftRecords = removeDraft(draftRecords, tab.id)
        continue
      }
      draftRecords = upsertDraft(draftRecords, rec)
    }
  }

  function refreshQueryTabTitle(tab: QueryTab) {
    if (tab.titleCustomized) return
    const n = deps.tabs.value.filter(
      (t) => t.kind === 'query' && t.connectionId === tab.connectionId,
    ).length
    const fallback = t('database.queryTitle', { n: Math.max(1, n) })
    tab.title = resolveQueryTabTitle({
      title: tab.title,
      titleCustomized: false,
      sql: tab.sql,
      fallback,
    })
  }

  function markQueryDirtyFromSql(tab: QueryTab) {
    refreshQueryTabTitle(tab)
    scheduleDraftSave()
  }

  async function restoreDraftsForConnection(connectionId: string) {
    if (!deps.liveSessions.value[connectionId]) return
    const known = new Set(deps.connections.value.map((c) => c.id))
    // Re-read storage so disconnect-flushed drafts are visible after reconnect
    loadDraftsFromStorage()
    draftRecords = pruneOrphanDrafts(draftRecords, known)
    const list = draftsForConnection(draftRecords, connectionId)
    let restoredAny = false
    for (const draft of list) {
      if (restoredDraftIds.has(draft.draftId)) continue
      if (
        !canRestoreDraft({
          draft,
          connectionId,
          connectionExists: known.has(connectionId),
        })
      ) {
        continue
      }
      // Skip only if this draftId tab is already open (exact id)
      if (deps.tabs.value.some((t) => t.id === draft.draftId)) {
        restoredDraftIds.add(draft.draftId)
        continue
      }
      const live = deps.liveSessions.value[connectionId]
      if (!live) return
      // Prefer stable draftId so re-save updates same record
      const id = draft.draftId
      const n =
        deps.tabs.value.filter((t) => t.kind === 'query' && t.connectionId === connectionId)
          .length + 1
      const fallback = t('database.queryTitle', { n })
      const title = resolveQueryTabTitle({
        title: draft.title || fallback,
        titleCustomized: draft.titleCustomized,
        sql: draft.sql,
        fallback,
      })
      deps.tabs.value.push({
        id,
        kind: 'query',
        connectionId,
        title,
        database: draft.database || live.database || '',
        sql: draft.sql,
        loading: false,
        error: '',
        errorDetail: '',
        errorCategory: '',
        errorRetryable: false,
        result: null,
        queryId: null,
        cancelling: false,
        inTransaction: false,
        autocommit: true,
        transactionStartedAt: null,
        outputKind: null,
        sort: null,
        filter: '',
        editorUi: null,
        lastFullDocExecutedSql: null,
        titleCustomized: draft.titleCustomized,
        readOnly: draft.readOnly === true,
        savedQueryId: draft.savedQueryId || null,
        // Legacy drafts missing fields fill from global defaults; explicit values preserved.
        ...resolveQueryTabExecOptionsFromDefaults(getCachedQueryTabDefaults(), {
          maxRows: draft.maxRows,
          timeoutMs: draft.timeoutMs,
          defaultRunScope: draft.defaultRunScope,
        }),
        // Restored drafts must never auto-run; only focus first restored tab
        focusEditor: !restoredAny,
      })
      restoredDraftIds.add(draft.draftId)
      restoredAny = true
    }
    if (restoredAny) {
      const first = deps.tabs.value.find(
        (t) => t.kind === 'query' && t.connectionId === connectionId,
      )
      if (first) deps.activeTabId.value = first.id
    }
  }

  function isQueryDirty(tab: QueryTab): boolean {
    return isQueryTabDirty({
      sql: tab.sql,
      lastFullDocExecutedSql: tab.lastFullDocExecutedSql ?? null,
    })
  }

  function onQuerySqlChanged(tabId: string) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    markQueryDirtyFromSql(tab)
  }

  function renameQueryTab(tabId: string, draftName: string): boolean {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return false
    const next = applyQueryTabRename({
      draft: draftName,
      previousTitle: tab.title,
      previousCustomized: !!tab.titleCustomized,
    })
    if (next.title === tab.title && next.titleCustomized === !!tab.titleCustomized) {
      return next.titleCustomized && draftName.trim().length > 0
    }
    tab.title = next.title
    tab.titleCustomized = next.titleCustomized
    scheduleDraftSave()
    return true
  }

  function initQueryDrafts() {
    loadDraftsFromStorage()
    const known = new Set(deps.connections.value.map((c) => c.id))
    draftRecords = pruneOrphanDrafts(draftRecords, known)
    writeDraftsToStorage()
  }

  function disposeQueryDrafts() {
    flushDraftsNow()
  }

  function removeDraftForTab(tabId: string) {
    draftRecords = removeDraft(draftRecords, tabId)
  }

  function clearRestoredMarker(tabId: string) {
    restoredDraftIds.delete(tabId)
  }

  function clearRestoredMarkersForConnection(connectionId: string) {
    for (const d of draftRecords) {
      if (d.connectionId === connectionId) restoredDraftIds.delete(d.draftId)
    }
  }

  function pruneDraftsForConnection(connectionId: string) {
    const removedIds = new Set(
      draftRecords.filter((d) => d.connectionId === connectionId).map((d) => d.draftId),
    )
    draftRecords = removeDraftsForConnection(draftRecords, connectionId)
    for (const id of removedIds) restoredDraftIds.delete(id)
    writeDraftsToStorage()
  }

  return {
    scheduleDraftSave,
    flushDraftsNow,
    syncOpenQueryTabsToDrafts,
    writeDraftsToStorage,
    restoreDraftsForConnection,
    isQueryDirty,
    onQuerySqlChanged,
    renameQueryTab,
    initQueryDrafts,
    disposeQueryDrafts,
    removeDraftForTab,
    clearRestoredMarker,
    clearRestoredMarkersForConnection,
    pruneDraftsForConnection,
  }
}
