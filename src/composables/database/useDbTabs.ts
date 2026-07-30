import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { getCachedQueryTabDefaults } from '@/composables/database/useDbSettings'
import { ElMessage } from 'element-plus/es/components/message/index'
import type {
  DbColumnInfo,
  DbConnection,
  DbSessionInfo,
  DbTableInfo,
} from '../../env.d'
import { filterRows, sortRows, type SqlDialect } from '@/utils/database/dbSql'
import type { QueryTab, WsTab } from '@/domain/database/types'
import {
  downloadTextFile,
  formatCell,
  resultToCsv,
  resultToTsv,
} from '@/domain/database/dbFormat'
import { t } from '../../i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import { assessSqlRisk, shouldConfirmSqlRisk } from '@/utils/database/sqlRisk'
import { parseDbError } from '@/utils/database/dbErrorUi'
import {
  bestEffortCancelQuery,
  cancelResultUi,
  isLiveRequest,
  nextRequestGen,
  shouldClearLoading,
  type RequestGenMap,
} from './dbAsyncGuard'
import { engineLabel } from './dbEngine'
import { applyTxServerState } from '@/utils/database/txUiState'
import { assessSqlReadOnly } from '@/utils/database/sqlReadOnly'
import {
  clampQueryMaxRows,
  clampQueryTimeoutMs,
  resolveQueryTabExecOptionsFromDefaults,
  sanitizeQueryTabExecOptions,
} from '@/utils/database/queryTabOptions'
import { buildExplainHistoryMeta } from '@/utils/database/queryHistoryLog'
import {
  nextLastFullDocExecutedSql,
  resolveQueryTabTitle,
} from '@/utils/database/queryDrafts'
import { useDbSavedQueries } from './useDbSavedQueries'
import { useDbQueryHistory } from './useDbQueryHistory'
import { useDbQueryDrafts } from './useDbQueryDrafts'
import { useDbTableTabOps } from './useDbTableTabOps'

export type DbTabsDeps = {
  liveSessions: Ref<Record<string, DbSessionInfo>>
  activeConnectionId: Ref<string | null>
  session: ComputedRef<DbSessionInfo | null>
  connections: Ref<DbConnection[]>
  liveSessionCount: ComputedRef<number>
  selectedTableKey: Ref<string>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  focusConnection: (connectionId: string) => void
  patchLiveSession: (connectionId: string, patch: Partial<DbSessionInfo>) => void
  dialectOf: (connectionId: string | null | undefined) => SqlDialect
  ensureTablesForDb: (connectionId: string, db: string) => Promise<void>
  ensureColumns: (connectionId: string, db: string, table: string) => Promise<DbColumnInfo[]>
  tablesOf: (connectionId: string, database: string) => DbTableInfo[]
  databasesOf: (connectionId: string | null | undefined) => string[]
  refreshDatabases: (connectionId?: string) => Promise<void>
}

export function useDbTabs(deps: DbTabsDeps) {
  const tabs = ref<WsTab[]>([])
  const activeTabId = ref<string | null>(null)
  let tabSeq = 1

  const dataLoadGen: RequestGenMap = new Map()
  const structureLoadGen: RequestGenMap = new Map()
  const queryRunGen: RequestGenMap = new Map()
  const metaLoadGen: RequestGenMap = new Map()

  const exportProgress = ref<{
    exportId: string
    rowsWritten: number
    phase: string
    error?: string
  } | null>(null)

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) || null)

  const activeQueryTab = computed(() => {
    const tab = activeTab.value
    return tab?.kind === 'query' ? (tab as QueryTab) : null
  })

  const drafts = useDbQueryDrafts({
    tabs,
    activeTabId,
    connections: deps.connections,
    liveSessions: deps.liveSessions,
  })

  const footerStatus = computed(() => {
    if (!deps.session.value) {
      return deps.liveSessionCount.value > 0
        ? t('database.footerMultiIdle', { count: deps.liveSessionCount.value })
        : t('database.footerIdle')
    }
    const s = deps.session.value
    const tab = activeTab.value
    let extra = ''
    if (tab?.kind === 'data' && tab.result) {
      const mode = tab.result.totalMode || 'exact'
      const totalLabel =
        mode === 'estimated'
          ? `~${tab.result.total}`
          : mode === 'unknown'
            ? (tab.result.hasNext ? `${tab.result.total}+` : String(tab.result.total))
            : String(tab.result.total)
      extra = t('database.footerPage', { page: tab.page, total: totalLabel })
    } else if (tab?.kind === 'query' && tab.result?.hasResultSet) {
      extra = t('database.footerQueryRows', {
        rows: tab.result.rowCount,
        ms: tab.result.durationMs,
      })
    }
    const multi =
      deps.liveSessionCount.value > 1
        ? t('database.footerMulti', { count: deps.liveSessionCount.value })
        : ''
    const eng = engineLabel(s.engine || 'mysql')
    const tunnel = s.viaTunnel
      ? t('database.footerTunnel', {
          name: s.sshConnectionName ? ` ${s.sshConnectionName}` : '',
        })
      : ''
    const tabDb = tab?.database || s.database
    return `${s.connectionName} ${s.username}@${s.host}:${s.port}${tabDb ? '/' + tabDb : ''} ${s.serverVersion || eng}${tunnel}${extra}${multi}`
  })

  async function copyText(text: string, okMsg = t('database.msg.copied')) {
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success(okMsg)
    } catch {
      ElMessage.error(t('database.msg.copyFailed'))
    }
  }

  function newTabId() {
    return `tab-${Date.now()}-${tabSeq++}`
  }

  async function openQueryTab(presetSql?: string, database?: string, connectionId?: string, savedQueryId?: string | null) {
    const connId = connectionId || deps.activeConnectionId.value
    if (!connId || !deps.liveSessions.value[connId]) {
      ElMessage.warning(t('database.msg.connectFirst'))
      return
    }
    deps.focusConnection(connId)
    const live = deps.liveSessions.value[connId]
    const id = newTabId()
    const n = tabs.value.filter((t) => t.kind === 'query' && t.connectionId === connId).length + 1
    const defaultDb = database !== undefined ? database : (live.database ?? '')
    const fallback = t('database.queryTitle', { n })
    const sql = presetSql || ''
    const title = resolveQueryTabTitle({
      title: fallback,
      titleCustomized: false,
      sql,
      fallback,
    })
    tabs.value.push({
      id,
      kind: 'query',
      connectionId: connId,
      title,
      database: defaultDb,
      sql,
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
      titleCustomized: false,
      // Default off so existing write/tx workflows are unchanged; user opts into RO
      readOnly: false,
      // Global defaults apply only at new-tab creation (not hot-overwrite open tabs).
      ...resolveQueryTabExecOptionsFromDefaults(getCachedQueryTabDefaults(), null),
      focusEditor: true,
      savedQueryId: savedQueryId || null,
    })
    activeTabId.value = id
    drafts.scheduleDraftSave()

    if (deps.databasesOf(connId).length === 0) {
      void deps.refreshDatabases(connId)
    }
    if (defaultDb) {
      try {
        await window.LiteConnect.dbUseDatabase(live.sessionId, defaultDb)
        deps.patchLiveSession(connId, { database: defaultDb })
      } catch {
        // 濞寸姴绉垫晶锕€顕ｉ埀顒勫蓟閵夘煈鍤勫銈囶暜缁辨繃娼婚幇顖ｆ斀闁哄啯婀圭槐浼村礃瀹ュ牏妲?USE
      }
      void deps.ensureTablesForDb(connId, defaultDb)
    }
    await nextTick()
  }

  /** 闁哄被鍎撮妤€顔忛妷銉ュ緮闁哄秴绻愰崹蹇涘箲閵忊剝娈堕柟璇″枛缁ㄩ亶鏁嶅杈╁綄闁?USE闁挎稑濂旂粚鑸电鎼粹剝鍊电紓?SQL 濮掓稒顭堥濠氭媰閽樺韬悹鍥ュ劚缁?*/
  async function onQueryDatabaseChange(tabId: string, database: string) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    if (tab.inTransaction) {
      // Never silent-switch DB while transaction is open
      ElMessage.warning(t('database.tx.switchDbBlocked'))
      return
    }
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    deps.focusConnection(tab.connectionId)
    tab.database = database
    if (!database) return
    try {
      await window.LiteConnect.dbUseDatabase(live.sessionId, database)
      deps.patchLiveSession(tab.connectionId, { database })
      void deps.ensureTablesForDb(tab.connectionId, database)
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.switchDbFailed'))
    }
  }

  const history = useDbQueryHistory({
    session: deps.session,
    liveSessions: deps.liveSessions,
    activeConnectionId: deps.activeConnectionId,
    getLiveSession: deps.getLiveSession,
    openQueryTab,
  })

  const saved = useDbSavedQueries({
    tabs,
    liveSessions: deps.liveSessions,
    activeConnectionId: deps.activeConnectionId,
    getLiveSession: deps.getLiveSession,
    scheduleDraftSave: drafts.scheduleDraftSave,
    openQueryTab,
  })

  const tableOps = useDbTableTabOps({
    tabs,
    activeTabId,
    activeTab: activeTab as any,
    liveSessions: deps.liveSessions,
    selectedTableKey: deps.selectedTableKey,
    getLiveSession: deps.getLiveSession,
    focusConnection: deps.focusConnection,
    newTabId,
    dataLoadGen,
    structureLoadGen,
    metaLoadGen,
    exportProgress,
  })


  function activeExportRows(): { columns: string[]; rows: Record<string, unknown>[]; name: string } | null {
    const tab = activeTab.value
    if (!tab) return null
    if (tab.kind === 'query' && tab.result?.hasResultSet) {
      let rows = tab.result.rows as Array<Record<string, unknown>>
      if (tab.sort) rows = sortRows(rows, tab.sort.col, tab.sort.dir)
      rows = filterRows(rows, tab.result.columns, tab.filter)
      return { columns: tab.result.columns, rows, name: 'query' }
    }
    if (tab.kind === 'data' && tab.result) {
      const columns = tab.result.columns
      let rows = tab.result.rows.map((row, index) => (tab.dirty[index] || row) as Record<string, unknown>)
      const q = tab.filter.trim().toLowerCase()
      if (q) {
        rows = rows.filter((row) =>
          columns.some((col) => {
            const v = row[col]
            if (v == null) return q === 'null'
            return String(v).toLowerCase().includes(q)
          }),
        )
      }
      return { columns, rows, name: tab.table }
    }
    return null
  }

  function exportActiveResultCsv() {
    const payload = activeExportRows()
    if (!payload) {
      ElMessage.warning(t('database.msg.noExportResult'))
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadTextFile(`${payload.name}-${stamp}.csv`, resultToCsv(payload.columns, payload.rows))
    ElMessage.success(t('database.msg.exportedCsv'))
  }

  async function copyActiveResult() {
    const payload = activeExportRows()
    if (!payload) {
      ElMessage.warning(t('database.msg.noCopyResult'))
      return
    }
    await copyText(
      resultToTsv(payload.columns, payload.rows),
      t('database.msg.copiedRows', { n: payload.rows.length }),
    )
  }

  async function copyResultCell(value: unknown) {
    await copyText(formatCell(value), t('database.msg.copiedCell'))
  }

  function exportActiveResultJson() {
    const payload = activeExportRows()
    if (!payload) {
      ElMessage.warning(t('database.msg.noExportResult'))
      return
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const text = JSON.stringify(payload.rows, null, 2)
    downloadTextFile(
      `${payload.name}-${stamp}.json`,
      text,
      'application/json;charset=utf-8',
    )
    ElMessage.success(t('database.msg.exportedJson'))
  }

  async function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx < 0) return
    const tab = tabs.value[idx]
    if (tab.kind === 'query' && tab.inTransaction) {
      try {
        await appConfirm({
          title: t('database.tx.closeTitle'),
          message: t('database.tx.closeMessage'),
          detail: t('database.tx.closeDetail'),
          danger: true,
          tone: 'danger',
          confirmText: t('database.tx.closeConfirm'),
        })
      } catch {
        return
      }
    }
    // Capture live ids before UI removal; best-effort cancel must not block close
    if (tab.kind === 'query') {
      const live = deps.getLiveSession(tab.connectionId)
      if (tab.queryId && live) {
        void bestEffortCancelQuery(live.sessionId, tab.queryId, (sid, qid) =>
          window.LiteConnect.dbCancelQuery(sid, qid),
        )
      }
      if (live) {
        void window.LiteConnect.dbReleaseClient(live.sessionId, tab.id).catch(() => {})
      }
    }
    // Invalidate in-flight so late responses are discarded
    nextRequestGen(dataLoadGen, id)
    nextRequestGen(structureLoadGen, id)
    nextRequestGen(queryRunGen, id)
    nextRequestGen(metaLoadGen, id)
    if (tab.kind === 'query') {
      drafts.removeDraftForTab(tab.id)
      drafts.scheduleDraftSave()
    }
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      activeTabId.value = (tabs.value[Math.max(0, idx - 1)] || tabs.value[0])?.id || null
    }
  }

  function newQueryId() {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  async function confirmDangerousSqlIfNeeded(sql: string): Promise<boolean> {
    try {
      const enabled = await window.LiteConnect.getDbConfirmDangerousSql()
      if (enabled === false) return true
    } catch {
      // default confirm on
    }
    let assessment = assessSqlRisk(sql)
    try {
      const remote = await window.LiteConnect.dbAssessSqlRisk(sql)
      if (remote && typeof remote.level === 'string') {
        assessment = {
          level: remote.level as any,
          kinds: (remote.kinds || []) as any,
          reasons: remote.reasons || [],
          uncertain: !!remote.uncertain,
        }
      }
    } catch {
      // use local assessment
    }
    if (!shouldConfirmSqlRisk(assessment)) return true
    const isUncertain = assessment.level === 'uncertain' && !assessment.kinds.some((k) =>
      k === 'drop' || k === 'truncate' || k === 'update_no_where' || k === 'delete_no_where',
    )
    try {
      await appConfirm({
        title: isUncertain
          ? t('database.risk.uncertainTitle')
          : t('database.risk.dangerTitle'),
        message: isUncertain
          ? t('database.risk.uncertainMessage')
          : t('database.risk.dangerMessage'),
        detail:
          (assessment.reasons.length
            ? assessment.reasons.join('; ')
            : '')
          + (isUncertain ? `\n${t('database.risk.uncertainDetail')}` : `\n${t('database.risk.dangerDetail')}`),
        danger: !isUncertain,
        tone: isUncertain ? 'warning' : 'danger',
        confirmText: t('database.risk.confirmRun'),
      })
      return true
    } catch {
      return false
    }
  }

  async function runQuerySql(sql: string, scope: 'selection' | 'statement' | 'all' = 'all') {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) {
      ElMessage.warning(t('database.msg.disconnected'))
      return
    }
    deps.focusConnection(tab.connectionId)
    const trimmed = sql.trim()
    if (!trimmed) {
      ElMessage.warning(t('database.msg.needSql'))
      return
    }
    // DQB-003: read-only check before danger confirm (cannot be bypassed by risk dialog)
    if (tab.readOnly) {
      const ro = assessSqlReadOnly(trimmed, deps.dialectOf(tab.connectionId))
      if (!ro.allowed) {
        ElMessage.warning(t('database.query.readOnlyBlocked', { reason: ro.summary }))
        return
      }
    }
    if (!(await confirmDangerousSqlIfNeeded(trimmed))) return

    const tabId = tab.id
    // Snapshot full document + explicit scope at dispatch (before any await)
    const dispatchFullDocSql = tab.sql
    const dispatchScope = scope
    const gen = nextRequestGen(queryRunGen, tabId)
    const queryId = newQueryId()
    const sessionId = live.sessionId
    const database = tab.database
    const connectionId = tab.connectionId
    const started = Date.now()
    tab.loading = true
    tab.cancelling = false
    tab.error = ''
    tab.errorDetail = ''
    tab.errorCategory = ''
    tab.errorRetryable = false
    // Keep previous result until success so errors go to messages without wiping grid
    tab.queryId = queryId
    tab.sort = null
    const maxRows = clampQueryMaxRows(tab.maxRows ?? 1000)
    const timeoutMs = clampQueryTimeoutMs(tab.timeoutMs ?? 120_000)
    try {
      const result = await window.LiteConnect.dbQuery(sessionId, trimmed, {
        maxRows,
        timeoutMs,
        queryId,
        database: database || undefined,
        clientKey: tabId,
        readOnly: !!tab.readOnly,
      })
      if (!isLiveRequest(queryRunGen, tabId, gen)) return
      const still = tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.result = result
      still.outputKind = 'result'
      // Scope-aware dirty: selection/statement never clear; all only if doc still matches dispatch
      still.lastFullDocExecutedSql = nextLastFullDocExecutedSql({
        scope: dispatchScope,
        dispatchFullDocSql,
        executedSql: trimmed,
        currentFullDocSql: still.sql,
        previous: still.lastFullDocExecutedSql ?? null,
      })
      drafts.scheduleDraftSave()
      if (still.database) {
        deps.patchLiveSession(still.connectionId, { database: still.database })
      }
      void history.pushQueryHistory(trimmed, still.database, {
        status: 'success',
        durationMs: result.durationMs ?? Date.now() - started,
        rowCount: result.hasResultSet ? result.rowCount : undefined,
        affectedRows: result.affectedRows,
        connectionId,
        runScope: dispatchScope,
        truncated: !!result.truncated,
      })
    } catch (err: any) {
      if (!isLiveRequest(queryRunGen, tabId, gen)) return
      const still = tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      const ui = parseDbError(err)
      still.error = ui.summary
      still.errorDetail = ui.detail || ''
      still.errorCategory = ui.category
      still.errorRetryable = ui.retryable
      const cancelled = ui.category === 'cancel'
      void history.pushQueryHistory(trimmed, still.database, {
        status: cancelled ? 'cancelled' : 'failed',
        durationMs: Date.now() - started,
        errorSummary: ui.summary,
        connectionId,
        runScope: dispatchScope,
      })
    } finally {
      if (shouldClearLoading(queryRunGen, tabId, gen)) {
        const still = tabs.value.find((t) => t.id === tabId)
        if (still && still.kind === 'query') {
          still.loading = false
          still.cancelling = false
          still.queryId = null
        }
      }
    }
  }

  function patchQueryTxFlags(
    tab: QueryTab,
    server: { inTransaction: boolean; autocommit: boolean } | null,
  ) {
    const next = applyTxServerState(
      {
        inTransaction: !!tab.inTransaction,
        autocommit: tab.autocommit !== false,
        transactionStartedAt: tab.transactionStartedAt ?? null,
      },
      server,
      Date.now(),
    )
    tab.inTransaction = next.inTransaction
    tab.autocommit = next.autocommit
    tab.transactionStartedAt = next.transactionStartedAt
  }

  async function beginTransaction() {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    if (tab.readOnly) {
      ElMessage.warning(t('database.query.readOnlyNoTx'))
      return
    }
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) {
      ElMessage.warning(t('database.msg.disconnected'))
      return
    }
    try {
      const st = await window.LiteConnect.dbBeginTransaction(
        live.sessionId,
        tab.id,
        tab.database || undefined,
      )
      patchQueryTxFlags(tab, st)
      ElMessage.success(t('database.tx.begun'))
    } catch (err: any) {
      // Failure: do not flip UI to in-transaction
      const ui = parseDbError(err)
      ElMessage.error(ui.summary)
    }
  }

  function setQueryReadOnly(tabId: string, readOnly: boolean) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    if (readOnly && tab.inTransaction) {
      ElMessage.warning(t('database.query.readOnlyNeedEndTx'))
      return
    }
    tab.readOnly = !!readOnly
    drafts.scheduleDraftSave()
  }

  function setQueryExecOptions(
    tabId: string,
    opts: { maxRows?: number; timeoutMs?: number; defaultRunScope?: QueryTab['defaultRunScope'] },
  ) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    const next = sanitizeQueryTabExecOptions({
      maxRows: opts.maxRows ?? tab.maxRows,
      timeoutMs: opts.timeoutMs ?? tab.timeoutMs,
      defaultRunScope: opts.defaultRunScope ?? tab.defaultRunScope,
    })
    tab.maxRows = next.maxRows
    tab.timeoutMs = next.timeoutMs
    tab.defaultRunScope = next.defaultRunScope
    drafts.scheduleDraftSave()
  }

  async function commitTransaction() {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    try {
      const st = await window.LiteConnect.dbCommitTransaction(live.sessionId, tab.id)
      patchQueryTxFlags(tab, st)
      ElMessage.success(t('database.tx.committed'))
    } catch (err: any) {
      // Failure: keep inTransaction / timer; never silent-switch to autocommit
      ElMessage.error(parseDbError(err).summary)
    }
  }

  async function rollbackTransaction() {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    try {
      const st = await window.LiteConnect.dbRollbackTransaction(live.sessionId, tab.id)
      patchQueryTxFlags(tab, st)
      ElMessage.success(t('database.tx.rolledBack'))
    } catch (err: any) {
      ElMessage.error(parseDbError(err).summary)
    }
  }

  async function explainQuerySql(sql: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) {
      ElMessage.warning(t('database.msg.disconnected'))
      return
    }
    deps.focusConnection(tab.connectionId)
    const trimmed = sql.trim()
    if (!trimmed) {
      ElMessage.warning(t('database.msg.needSqlExplain'))
      return
    }
    const tabId = tab.id
    const gen = nextRequestGen(queryRunGen, tabId)
    const sessionId = live.sessionId
    const database = tab.database
    const connectionId = tab.connectionId
    const started = Date.now()
    tab.loading = true
    tab.cancelling = false
    tab.error = ''
    tab.errorDetail = ''
    tab.errorCategory = ''
    tab.errorRetryable = false
    tab.sort = null
    // Clear local result filter so plan grid is never hidden by stale filter text
    tab.filter = ''
    try {
      const result = await window.LiteConnect.dbExplain(
        sessionId,
        trimmed,
        database || undefined,
      )
      if (!isLiveRequest(queryRunGen, tabId, gen)) return
      const still = tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.result = result
      still.outputKind = 'plan'
      still.filter = ''
      void history.pushQueryHistory(
        trimmed,
        still.database,
        buildExplainHistoryMeta({
          startedAtMs: started,
          nowMs: Date.now(),
          connectionId,
          outcome: {
            kind: 'success',
            rowCount: result.hasResultSet ? result.rowCount : undefined,
            durationMs: result.durationMs ?? Date.now() - started,
            truncated: !!result.truncated,
          },
        }),
      )
    } catch (err: any) {
      if (!isLiveRequest(queryRunGen, tabId, gen)) return
      const still = tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      const ui = parseDbError(err)
      still.error = ui.summary || err.message || t('database.msg.explainFailed')
      still.errorDetail = ui.detail || ''
      still.errorCategory = ui.category
      still.errorRetryable = ui.retryable
      const cancelled = ui.category === 'cancel'
      void history.pushQueryHistory(
        trimmed,
        still.database,
        buildExplainHistoryMeta({
          startedAtMs: started,
          nowMs: Date.now(),
          connectionId,
          outcome: {
            kind: cancelled ? 'cancelled' : 'failed',
            errorSummary: ui.summary || still.error,
          },
        }),
      )
    } finally {
      if (shouldClearLoading(queryRunGen, tabId, gen)) {
        const still = tabs.value.find((t) => t.id === tabId)
        if (still && still.kind === 'query') still.loading = false
      }
    }
  }

  async function cancelActiveQuery() {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query' || !tab.queryId) return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    tab.cancelling = true
    try {
      const result = await window.LiteConnect.dbCancelQuery(live.sessionId, tab.queryId)
      const ui = cancelResultUi(result)
      if (ui.kind === 'info') {
        ElMessage.info(
          ui.status === 'requested'
            ? t('database.msg.cancelSent')
            : t('database.msg.cancelling'),
        )
      } else if (ui.kind === 'error') {
        ElMessage.error(ui.error || t('database.msg.cancelFailed'))
        tab.cancelling = false
      } else if (ui.status === 'already_finished') {
        // Query already done 闁?no success toast; clear cancelling when result lands
        tab.cancelling = false
      }
    } catch (err: any) {
      tab.cancelling = false
      ElMessage.error(err.message || t('database.msg.cancelFailed'))
    }
  }

  function connectionNameOf(connectionId: string): string {
    return (
      deps.liveSessions.value[connectionId]?.connectionName
      || deps.connections.value.find((c) => c.id === connectionId)?.name
      || t('database.connectionFallback')
    )
  }

  function connectionMetaOf(connectionId: string): string {
    const live = deps.liveSessions.value[connectionId]
    if (live) return `${live.username}@${live.host}:${live.port}`
    const c = deps.connections.value.find((x) => x.id === connectionId)
    if (c) return `${c.username}@${c.host}:${c.port || 3306}`
    return ''
  }

  function tabBarTitle(tab: WsTab): string {
    if (tab.kind === 'query') {
      if (tab.database) return `${tab.database} 璺?${tab.title}`
      return tab.title
    }
    return `${tab.database}.${tab.table}`
  }

  function tabBarTooltip(tab: WsTab): string {
    const conn = connectionNameOf(tab.connectionId)
    const meta = connectionMetaOf(tab.connectionId)
    const host = meta ? ` (${meta})` : ''
    if (tab.kind === 'query') {
      return t('database.tabTooltipQuery', {
        conn,
        host,
        db: tab.database || t('database.noDatabase'),
        title: tab.title,
      })
    }
    return t('database.tabTooltipTable', {
      conn,
      host,
      database: tab.database,
      table: 'table' in tab ? tab.table : '',
    })
  }

  function activateTab(tabId: string) {
    activeTabId.value = tabId
    const tab = tabs.value.find((t) => t.id === tabId)
    if (tab?.connectionId && deps.liveSessions.value[tab.connectionId]) {
      deps.focusConnection(tab.connectionId)
    }
  }

  function queryEnsureTables(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return Promise.resolve()
    return deps.ensureTablesForDb(tab.connectionId, database)
  }

  function queryEnsureColumns(database: string, table: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return Promise.resolve([] as DbColumnInfo[])
    return deps.ensureColumns(tab.connectionId, database, table)
  }

  function queryGetTables(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return [] as DbTableInfo[]
    return deps.tablesOf(tab.connectionId, database)
  }

  function onQueryChangeDatabase(database: string) {
    const tab = activeTab.value
    if (!tab || tab.kind !== 'query') return
    void onQueryDatabaseChange(tab.id, database)
  }

  function onTableClick(connectionId: string, database: string, table: DbTableInfo) {
    tableOps.openDataTab(connectionId, database, table.name)
  }

  function clearTabsForConnection(connectionId: string) {
    drafts.syncOpenQueryTabsToDrafts()
    drafts.writeDraftsToStorage()
    const removed = tabs.value.filter((t) => t.connectionId === connectionId)
    for (const t of removed) {
      nextRequestGen(dataLoadGen, t.id)
      nextRequestGen(structureLoadGen, t.id)
      nextRequestGen(queryRunGen, t.id)
      nextRequestGen(metaLoadGen, t.id)
      if (t.kind === 'query') {
        drafts.clearRestoredMarker(t.id)
        const live = deps.getLiveSession(connectionId)
        if (live) {
          void window.LiteConnect.dbReleaseClient(live.sessionId, t.id).catch(() => {})
        }
      }
    }
    drafts.clearRestoredMarkersForConnection(connectionId)
    const remainingTabs = tabs.value.filter((t) => t.connectionId !== connectionId)
    tabs.value = remainingTabs
    if (!remainingTabs.some((t) => t.id === activeTabId.value)) {
      activeTabId.value = remainingTabs[0]?.id || null
    }
  }

  function hasQueryTabFor(connectionId: string) {
    return tabs.value.some((t) => t.connectionId === connectionId && t.kind === 'query')
  }

  function hasOpenTransactionFor(connectionId: string) {
    return tabs.value.some(
      (t) => t.connectionId === connectionId && t.kind === 'query' && t.inTransaction,
    )
  }

  async function confirmDisconnectIfNeeded(connectionId: string): Promise<boolean> {
    if (!hasOpenTransactionFor(connectionId)) return true
    try {
      await appConfirm({
        title: t('database.tx.disconnectTitle'),
        message: t('database.tx.disconnectMessage'),
        detail: t('database.tx.disconnectDetail'),
        danger: true,
        tone: 'danger',
        confirmText: t('database.tx.disconnectConfirm'),
      })
      return true
    } catch {
      return false
    }
  }

  return {
    tabs,
    activeTabId,
    queryHistory: history.queryHistory,
    historyOnlyCurrent: history.historyOnlyCurrent,
    historyStatusFilter: history.historyStatusFilter,
    exportProgress,
    activeTab,
    activeQueryTab,
    displayedHistory: history.displayedHistory,
    footerStatus,
    refreshQueryHistory: history.refreshQueryHistory,
    migrateLegacyQueryHistory: history.migrateLegacyQueryHistory,
    openQueryTab,
    openDataTab: tableOps.openDataTab,
    openStructureTab: tableOps.openStructureTab,
    setTablePanel: tableOps.setTablePanel,
    closeTab,
    activateTab,
    loadDataPage: tableOps.loadDataPage,
    loadDataMeta: tableOps.loadDataMeta,
    loadStructure: tableOps.loadStructure,
    runQuerySql,
    explainQuerySql,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    cancelActiveQuery,
    toggleDataSort: tableOps.toggleDataSort,
    applyServerSearch: tableOps.applyServerSearch,
    changeDataPage: tableOps.changeDataPage,
    jumpDataPage: tableOps.jumpDataPage,
    changeDataPageSize: tableOps.changeDataPageSize,
    clearQueryHistory: history.clearQueryHistory,
    applyHistoryItem: history.applyHistoryItem,
    exportActiveResultCsv,
    exportActiveResultJson,
    exportTableAllCsv: tableOps.exportTableAllCsv,
    cancelTableExport: tableOps.cancelTableExport,
    copyActiveResult,
    copyResultCell,
    tabBarTitle,
    tabBarTooltip,
    connectionNameOf,
    connectionMetaOf,
    queryEnsureTables,
    queryEnsureColumns,
    queryGetTables,
    onQueryChangeDatabase,
    onTableClick,
    clearTabsForConnection,
    pruneDraftsForConnection: drafts.pruneDraftsForConnection,
    hasQueryTabFor,
    hasOpenTransactionFor,
    confirmDisconnectIfNeeded,
    isQueryDirty: drafts.isQueryDirty,
    onQuerySqlChanged: drafts.onQuerySqlChanged,
    renameQueryTab: drafts.renameQueryTab,
    setQueryReadOnly,
    setQueryExecOptions,
    initQueryDrafts: drafts.initQueryDrafts,
    disposeQueryDrafts: drafts.disposeQueryDrafts,
    restoreDraftsForConnection: drafts.restoreDraftsForConnection,
    flushDraftsNow: drafts.flushDraftsNow,
    savedQueries: saved.savedQueries,
    saveQuery: saved.saveQuery,
    deleteSavedQuery: saved.deleteSavedQuery,
    renameSavedQuery: saved.renameSavedQuery,
    applySavedQuery: saved.applySavedQuery,
  }
}
