import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbSessionInfo } from '../../env.d'
import type { QueryHistoryItem } from '../../components/database/types'
import { t } from '../../i18n'
import { filterHistoryItems } from '../../utils/queryHistoryLog'

export type DbQueryHistoryDeps = {
  session: ComputedRef<DbSessionInfo | null>
  liveSessions: Ref<Record<string, DbSessionInfo>>
  activeConnectionId: Ref<string | null>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  openQueryTab: (
    presetSql?: string,
    database?: string,
    connectionId?: string,
    savedQueryId?: string | null,
  ) => void | Promise<void>
}

export function useDbQueryHistory(deps: DbQueryHistoryDeps) {
  const LEGACY_HISTORY_KEY = 'LiteConnect.dbQueryHistory.v1'
  const LEGACY_HISTORY_KEY_OLD = 'liteSSH.dbQueryHistory.v1'
  const queryHistory = ref<QueryHistoryItem[]>([])
  const historyOnlyCurrent = ref(true)
  const historyStatusFilter = ref<'all' | 'success' | 'failed' | 'cancelled' | 'slow'>('all')

  const displayedHistory = computed(() => {
    const connId =
      historyOnlyCurrent.value && deps.session.value?.connectionId
        ? deps.session.value.connectionId
        : null
    return filterHistoryItems(queryHistory.value, {
      onlyConnectionId: connId,
      status: historyStatusFilter.value,
    })
  })

  async function refreshQueryHistory() {
    try {
      const connId = deps.session.value?.connectionId
      queryHistory.value = await window.LiteConnect.dbListQueryHistory(connId)
    } catch {
      // 历史加载失败不影响主流程
    }
  }

  async function migrateLegacyQueryHistory() {
    try {
      const raw =
        localStorage.getItem(LEGACY_HISTORY_KEY) ?? localStorage.getItem(LEGACY_HISTORY_KEY_OLD)
      if (!raw) return
      const list = JSON.parse(raw)
      if (!Array.isArray(list) || list.length === 0) {
        localStorage.removeItem(LEGACY_HISTORY_KEY)
        localStorage.removeItem(LEGACY_HISTORY_KEY_OLD)
        return
      }
      queryHistory.value = await window.LiteConnect.dbMergeQueryHistoryLegacy(list)
      localStorage.removeItem(LEGACY_HISTORY_KEY)
      localStorage.removeItem(LEGACY_HISTORY_KEY_OLD)
    } catch {
      // ignore
    }
  }

  async function pushQueryHistory(
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
  ) {
    const trimmed = sql.trim()
    if (!trimmed) return
    try {
      queryHistory.value = await window.LiteConnect.dbPushQueryHistory({
        sql: trimmed,
        database,
        connectionId: meta?.connectionId || deps.session.value?.connectionId,
        status: meta?.status || 'success',
        durationMs: meta?.durationMs,
        rowCount: meta?.rowCount,
        affectedRows: meta?.affectedRows,
        errorSummary: meta?.errorSummary,
        runScope: meta?.runScope,
        truncated: meta?.truncated === true ? true : undefined,
      })
    } catch {
      // 写历史失败不阻断查询结果展示
    }
  }

  async function clearQueryHistory() {
    try {
      const onlyCurrent = historyOnlyCurrent.value && deps.session.value?.connectionId
      queryHistory.value = await window.LiteConnect.dbClearQueryHistory(
        onlyCurrent ? deps.session.value!.connectionId : undefined,
      )
      await refreshQueryHistory()
      ElMessage.success(
        onlyCurrent ? t('database.msg.historyClearedCurrent') : t('database.msg.historyClearedAll'),
      )
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.clearFailed'))
    }
  }

  function applyHistoryItem(item: QueryHistoryItem) {
    const connId =
      (item.connectionId && deps.liveSessions.value[item.connectionId] && item.connectionId)
      || deps.activeConnectionId.value
      || undefined
    if (!connId) {
      ElMessage.warning(t('database.msg.connectFirst'))
      return
    }
    void deps.openQueryTab(
      item.sql,
      item.database || deps.getLiveSession(connId)?.database || '',
      connId,
    )
  }

  return {
    queryHistory,
    historyOnlyCurrent,
    historyStatusFilter,
    displayedHistory,
    refreshQueryHistory,
    migrateLegacyQueryHistory,
    pushQueryHistory,
    clearQueryHistory,
    applyHistoryItem,
  }
}
