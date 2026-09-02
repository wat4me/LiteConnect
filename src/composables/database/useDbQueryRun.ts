import { ElMessage } from 'element-plus/es/components/message/index'
import type { ComputedRef, Ref } from 'vue'
import type { DbSessionInfo } from '../../env.d'
import type { QueryTab, WsTab } from '@/domain/database/types'
import type { SqlDialect } from '@/utils/database/dbSql'
import { t } from '../../i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import { assessSqlRisk, shouldConfirmSqlRisk } from '@/utils/database/sqlRisk'
import { parseDbError } from '@/utils/database/dbErrorUi'
import {
  cancelResultUi,
  isLiveRequest,
  nextRequestGen,
  shouldClearLoading,
  type RequestGenMap,
} from './dbAsyncGuard'
import { applyTxServerState } from '@/utils/database/txUiState'
import { assessSqlReadOnly } from '@/utils/database/sqlReadOnly'
import {
  clampQueryMaxRows,
  clampQueryTimeoutMs,
  sanitizeQueryTabExecOptions,
} from '@/utils/database/queryTabOptions'
import { buildExplainHistoryMeta } from '@/utils/database/queryHistoryLog'
import { nextLastFullDocExecutedSql } from '@/utils/database/queryDrafts'
export type DbQueryRunDeps = {
  tabs: Ref<WsTab[]>
  activeTab: ComputedRef<WsTab | null>
  queryRunGen: RequestGenMap
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  focusConnection: (connectionId: string) => void
  dialectOf: (connectionId: string | null | undefined) => SqlDialect
  patchLiveSession: (connectionId: string, patch: Partial<DbSessionInfo>) => void
  scheduleDraftSave: () => void
  pushQueryHistory: (
    sql: string,
    database: string,
    meta?: {
      status?: 'success' | 'failed' | 'cancelled'
      durationMs?: number
      rowCount?: number
      affectedRows?: number
      errorSummary?: string
      connectionId?: string
      runScope?: 'selection' | 'statement' | 'all' | 'explain'
      truncated?: boolean
    },
  ) => void | Promise<void>
}

export function useDbQueryRun(deps: DbQueryRunDeps) {
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
    const tab = deps.activeTab.value
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
    if (tab.readOnly) {
      const ro = assessSqlReadOnly(trimmed, deps.dialectOf(tab.connectionId))
      if (!ro.allowed) {
        ElMessage.warning(t('database.query.readOnlyBlocked', { reason: ro.summary }))
        return
      }
    }
    if (!(await confirmDangerousSqlIfNeeded(trimmed))) return

    const tabId = tab.id
    const dispatchFullDocSql = tab.sql
    const dispatchScope = scope
    const gen = nextRequestGen(deps.queryRunGen, tabId)
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
      if (!isLiveRequest(deps.queryRunGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.result = result
      still.outputKind = 'result'
      still.lastFullDocExecutedSql = nextLastFullDocExecutedSql({
        scope: dispatchScope,
        dispatchFullDocSql,
        executedSql: trimmed,
        currentFullDocSql: still.sql,
        previous: still.lastFullDocExecutedSql ?? null,
      })
      deps.scheduleDraftSave()
      if (still.database) {
        deps.patchLiveSession(still.connectionId, { database: still.database })
      }
      void deps.pushQueryHistory(trimmed, still.database, {
        status: 'success',
        durationMs: result.durationMs ?? Date.now() - started,
        rowCount: result.hasResultSet ? result.rowCount : undefined,
        affectedRows: result.affectedRows,
        connectionId,
        runScope: dispatchScope,
        truncated: !!result.truncated,
      })
    } catch (err: any) {
      if (!isLiveRequest(deps.queryRunGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      const ui = parseDbError(err)
      still.error = ui.summary
      still.errorDetail = ui.detail || ''
      still.errorCategory = ui.category
      still.errorRetryable = ui.retryable
      const cancelled = ui.category === 'cancel'
      void deps.pushQueryHistory(trimmed, still.database, {
        status: cancelled ? 'cancelled' : 'failed',
        durationMs: Date.now() - started,
        errorSummary: ui.summary,
        connectionId,
        runScope: dispatchScope,
      })
    } finally {
      if (shouldClearLoading(deps.queryRunGen, tabId, gen)) {
        const still = deps.tabs.value.find((t) => t.id === tabId)
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
    const tab = deps.activeTab.value
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
      const ui = parseDbError(err)
      ElMessage.error(ui.summary)
    }
  }

  function setQueryReadOnly(tabId: string, readOnly: boolean) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    if (readOnly && tab.inTransaction) {
      ElMessage.warning(t('database.query.readOnlyNeedEndTx'))
      return
    }
    tab.readOnly = !!readOnly
    deps.scheduleDraftSave()
  }

  function setQueryExecOptions(
    tabId: string,
    opts: { maxRows?: number; timeoutMs?: number; defaultRunScope?: QueryTab['defaultRunScope'] },
  ) {
    const tab = deps.tabs.value.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'query') return
    const next = sanitizeQueryTabExecOptions({
      maxRows: opts.maxRows ?? tab.maxRows,
      timeoutMs: opts.timeoutMs ?? tab.timeoutMs,
      defaultRunScope: opts.defaultRunScope ?? tab.defaultRunScope,
    })
    tab.maxRows = next.maxRows
    tab.timeoutMs = next.timeoutMs
    tab.defaultRunScope = next.defaultRunScope
    deps.scheduleDraftSave()
  }

  async function commitTransaction() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'query') return
    const live = deps.getLiveSession(tab.connectionId)
    if (!live) return
    try {
      const st = await window.LiteConnect.dbCommitTransaction(live.sessionId, tab.id)
      patchQueryTxFlags(tab, st)
      ElMessage.success(t('database.tx.committed'))
    } catch (err: any) {
      ElMessage.error(parseDbError(err).summary)
    }
  }

  async function rollbackTransaction() {
    const tab = deps.activeTab.value
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
    const tab = deps.activeTab.value
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
    const gen = nextRequestGen(deps.queryRunGen, tabId)
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
    tab.filter = ''
    try {
      const result = await window.LiteConnect.dbExplain(
        sessionId,
        trimmed,
        database || undefined,
      )
      if (!isLiveRequest(deps.queryRunGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      still.result = result
      still.outputKind = 'plan'
      still.filter = ''
      void deps.pushQueryHistory(
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
      if (!isLiveRequest(deps.queryRunGen, tabId, gen)) return
      const still = deps.tabs.value.find((t) => t.id === tabId)
      if (!still || still.kind !== 'query') return
      if (!deps.getLiveSession(still.connectionId)) return
      const ui = parseDbError(err)
      still.error = ui.summary || err.message || t('database.msg.explainFailed')
      still.errorDetail = ui.detail || ''
      still.errorCategory = ui.category
      still.errorRetryable = ui.retryable
      const cancelled = ui.category === 'cancel'
      void deps.pushQueryHistory(
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
      if (shouldClearLoading(deps.queryRunGen, tabId, gen)) {
        const still = deps.tabs.value.find((t) => t.id === tabId)
        if (still && still.kind === 'query') still.loading = false
      }
    }
  }

  async function cancelActiveQuery() {
    const tab = deps.activeTab.value
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
        tab.cancelling = false
      }
    } catch (err: any) {
      tab.cancelling = false
      ElMessage.error(err.message || t('database.msg.cancelFailed'))
    }
  }

  return {
    runQuerySql,
    explainQuerySql,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    cancelActiveQuery,
    setQueryReadOnly,
    setQueryExecOptions,
  }
}
