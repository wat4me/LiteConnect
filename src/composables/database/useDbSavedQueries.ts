import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbSessionInfo } from '../../env.d'
import type { QueryTab, SavedQuery, WsTab } from '@/domain/database/types'
import { t } from '../../i18n'
import { sqlTitleSummary } from '@/utils/database/queryDrafts'

export type DbSavedQueriesDeps = {
  tabs: Ref<WsTab[]>
  liveSessions: Ref<Record<string, DbSessionInfo>>
  activeConnectionId: Ref<string | null>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  scheduleDraftSave: () => void
  openQueryTab: (
    presetSql?: string,
    database?: string,
    connectionId?: string,
    savedQueryId?: string | null,
  ) => void | Promise<void>
}

export function useDbSavedQueries(deps: DbSavedQueriesDeps) {
  const savedQueries = ref<SavedQuery[]>([])

  function loadSavedQueries() {
    try {
      const raw = localStorage.getItem('LiteConnect.db.savedQueries')
      savedQueries.value = raw ? JSON.parse(raw) : []
    } catch {
      savedQueries.value = []
    }
  }

  function saveQuery(tabId: string, sql: string, connectionId: string, database: string) {
    if (!sql || !sql.trim()) return
    loadSavedQueries()
    const tab = deps.tabs.value.find((t) => t.id === tabId) as QueryTab | undefined
    if (!tab) return

    if (tab.savedQueryId) {
      const existing = savedQueries.value.find((q) => q.id === tab.savedQueryId)
      if (existing) {
        existing.sql = sql
        existing.database = database
        localStorage.setItem('LiteConnect.db.savedQueries', JSON.stringify(savedQueries.value))
        ElMessage.success(t('database.query.saveSuccess'))
        return
      }
    }

    const title = sqlTitleSummary(sql) || '未命名脚本'
    const newQuery: SavedQuery = {
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title,
      sql,
      connectionId,
      database,
      createdAt: Date.now(),
    }
    savedQueries.value = [newQuery, ...savedQueries.value]
    localStorage.setItem('LiteConnect.db.savedQueries', JSON.stringify(savedQueries.value))
    tab.savedQueryId = newQuery.id
    deps.scheduleDraftSave()
    ElMessage.success(t('database.query.saveSuccess'))
  }

  function deleteSavedQuery(id: string) {
    savedQueries.value = savedQueries.value.filter((q) => q.id !== id)
    localStorage.setItem('LiteConnect.db.savedQueries', JSON.stringify(savedQueries.value))
    for (const tab of deps.tabs.value) {
      if (tab.kind === 'query' && tab.savedQueryId === id) {
        tab.savedQueryId = null
      }
    }
    deps.scheduleDraftSave()
    ElMessage.success(t('database.query.deleteSuccess'))
  }

  function renameSavedQuery(id: string, newTitle: string) {
    const item = savedQueries.value.find((q) => q.id === id)
    if (item && newTitle.trim()) {
      item.title = newTitle.trim()
      localStorage.setItem('LiteConnect.db.savedQueries', JSON.stringify(savedQueries.value))
      for (const tab of deps.tabs.value) {
        if (tab.kind === 'query' && tab.savedQueryId === id && !tab.titleCustomized) {
          tab.title = newTitle.trim()
        }
      }
      ElMessage.success(t('database.query.renameSuccess'))
    }
  }

  function applySavedQuery(item: SavedQuery) {
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
      item.id,
    )
  }

  loadSavedQueries()

  return {
    savedQueries,
    loadSavedQueries,
    saveQuery,
    deleteSavedQuery,
    renameSavedQuery,
    applySavedQuery,
  }
}
