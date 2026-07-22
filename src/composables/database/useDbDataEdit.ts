import type { ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { DbSessionInfo } from '../../env.d'
import { t } from '../../i18n'
import { appConfirm } from '../useAppDialog'
import {
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
  parseCellInput,
  type SqlDialect,
} from '../../utils/dbSql'
import type { WsTab } from '../../components/database/types'
import { formatCell } from '../../components/database/dbFormat'

export type DbDataEditDeps = {
  activeTab: ComputedRef<WsTab | null>
  getLiveSession: (connectionId: string | null | undefined) => DbSessionInfo | null
  dialectOf: (connectionId: string | null | undefined) => SqlDialect
  loadDataPage: (tabId: string) => Promise<void>
}

export function useDbDataEdit(deps: DbDataEditDeps) {
  function dataCellValue(
    tab: Extract<WsTab, { kind: 'data' }>,
    rowIndex: number,
    col: string,
  ): unknown {
    const dirty = tab.dirty[rowIndex]
    if (dirty && col in dirty) return dirty[col]
    return tab.result?.rows[rowIndex]?.[col]
  }

  function startEditCell(rowIndex: number, col: string) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || tab.saving) return
    if (tab.pkColumns.length === 0) {
      ElMessage.warning(t('database.msg.noPkEdit'))
      return
    }
    const val = dataCellValue(tab, rowIndex, col)
    if (typeof val === 'string' && val.startsWith('<BLOB ')) {
      ElMessage.warning(t('database.msg.blobEdit'))
      return
    }
    tab.editCell = { rowIndex, col }
    tab.editAsNull = val === null || val === undefined
    tab.editDraft = tab.editAsNull ? '' : formatCell(val)
  }

  function cancelEditCell() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    tab.editCell = null
    tab.editDraft = ''
    tab.editAsNull = false
  }

  function commitEditCell() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || !tab.editCell || !tab.result) return
    const { rowIndex, col } = tab.editCell
    const base = {
      ...(tab.result.rows[rowIndex] as Record<string, unknown>),
      ...(tab.dirty[rowIndex] || {}),
    }
    const nextVal = parseCellInput(tab.editDraft, tab.editAsNull)
    const orig = tab.result.rows[rowIndex]?.[col]
    const same =
      (nextVal == null && orig == null) ||
      (nextVal != null && orig != null && String(nextVal) === String(orig))
    if (same) {
      const copy = { ...base, [col]: orig }
      const remaining = tab.result.columns.some((c) => {
        if (c === col) return false
        const d = tab.dirty[rowIndex]
        if (!d || !(c in d)) return false
        const o = tab.result!.rows[rowIndex]?.[c]
        return String(d[c] ?? '') !== String(o ?? '') || (d[c] == null) !== (o == null)
      })
      if (!remaining) {
        const { [rowIndex]: _, ...rest } = tab.dirty
        tab.dirty = rest
      } else {
        tab.dirty = { ...tab.dirty, [rowIndex]: copy }
      }
    } else {
      tab.dirty = { ...tab.dirty, [rowIndex]: { ...base, [col]: nextVal } }
    }
    tab.editCell = null
    tab.editDraft = ''
    tab.editAsNull = false
  }

  function onEditCellKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEditCell()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditCell()
    }
  }

  function onEditCellBlur() {
    setTimeout(() => {
      const tab = deps.activeTab.value
      if (!tab || tab.kind !== 'data' || !tab.editCell) return
      commitEditCell()
    }, 150)
  }

  function setInsertCell(col: string, value: string) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || !tab.inserting) return
    tab.inserting = { ...tab.inserting, [col]: value === '' ? null : value }
  }

  function toggleSelectRow(rowIndex: number) {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    if (tab.selected.includes(rowIndex)) {
      tab.selected = tab.selected.filter((i) => i !== rowIndex)
    } else {
      tab.selected = [...tab.selected, rowIndex]
    }
  }

  function startInsertRow() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data' || !tab.result) return
    if (tab.pkColumns.length === 0 && tab.columnsMeta.length === 0) {
      ElMessage.warning(t('database.msg.noColumns'))
      return
    }
    const row: Record<string, unknown> = {}
    for (const col of tab.result.columns) {
      const meta = tab.columnsMeta.find((c) => c.name === col)
      if (meta?.extra?.toLowerCase().includes('auto_increment')) {
        row[col] = null
      } else if (meta?.defaultValue != null) {
        row[col] = meta.defaultValue
      } else if (meta?.nullable) {
        row[col] = null
      } else {
        row[col] = ''
      }
    }
    tab.inserting = row
  }

  function cancelInsertRow() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    tab.inserting = null
  }

  async function saveInsertRow() {
    const tab = deps.activeTab.value
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !tab.inserting || !tab.result || !live) return
    const sql = buildInsertSql(
      tab.database,
      tab.table,
      tab.result.columns,
      tab.inserting,
      deps.dialectOf(tab.connectionId),
    )
    tab.saving = true
    try {
      await window.LiteConnect.dbQuery(live.sessionId, sql, {
        timeoutMs: 30000,
        database: tab.database,
      })
      ElMessage.success(t('database.msg.inserted'))
      tab.inserting = null
      await deps.loadDataPage(tab.id)
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.insertFailed'))
    } finally {
      tab.saving = false
    }
  }

  async function saveDirtyRows() {
    const tab = deps.activeTab.value
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !tab.result || !live) return
    if (tab.editCell) commitEditCell()
    if (tab.pkColumns.length === 0) {
      ElMessage.warning(t('database.msg.noPkSave'))
      return
    }
    const indexes = Object.keys(tab.dirty).map(Number)
    if (indexes.length === 0) {
      ElMessage.info(t('database.msg.noDirty'))
      return
    }
    tab.saving = true
    try {
      for (const ri of indexes) {
        const original = tab.result.rows[ri] as Record<string, unknown>
        const modified = tab.dirty[ri]
        if (!original || !modified) continue
        const sql = buildUpdateSql(
          tab.database,
          tab.table,
          tab.pkColumns,
          original,
          modified,
          tab.result.columns,
          deps.dialectOf(tab.connectionId),
        )
        if (!sql) continue
        await window.LiteConnect.dbQuery(live.sessionId, sql, {
          timeoutMs: 30000,
          database: tab.database,
        })
      }
      ElMessage.success(t('database.msg.savedRows', { n: indexes.length }))
      tab.dirty = {}
      await deps.loadDataPage(tab.id)
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.saveFailed'))
    } finally {
      tab.saving = false
    }
  }

  async function deleteSelectedRows() {
    const tab = deps.activeTab.value
    const live = tab && tab.kind === 'data' ? deps.getLiveSession(tab.connectionId) : null
    if (!tab || tab.kind !== 'data' || !tab.result || !live) return
    if (tab.pkColumns.length === 0) {
      ElMessage.warning(t('database.msg.noPkDelete'))
      return
    }
    if (tab.selected.length === 0) {
      ElMessage.warning(t('database.msg.selectRows'))
      return
    }
    try {
      await appConfirm({
        title: t('database.msg.deleteRowsTitle'),
        message: t('database.msg.deleteRowsMessage', { n: tab.selected.length }),
        detail: t('database.msg.deleteRowsDetail'),
        confirmText: t('common.delete'),
        danger: true,
        tone: 'danger',
      })
    } catch {
      return
    }
    tab.saving = true
    try {
      for (const ri of tab.selected) {
        const row = (tab.dirty[ri] || tab.result.rows[ri]) as Record<string, unknown>
        const sql = buildDeleteSql(
          tab.database,
          tab.table,
          tab.pkColumns,
          row,
          deps.dialectOf(tab.connectionId),
        )
        if (!sql) continue
        await window.LiteConnect.dbQuery(live.sessionId, sql, {
          timeoutMs: 30000,
          database: tab.database,
        })
      }
      ElMessage.success(t('database.msg.deleted'))
      tab.selected = []
      tab.dirty = {}
      await deps.loadDataPage(tab.id)
    } catch (err: any) {
      ElMessage.error(err.message || t('database.msg.deleteFailed'))
    } finally {
      tab.saving = false
    }
  }

  function discardDirty() {
    const tab = deps.activeTab.value
    if (!tab || tab.kind !== 'data') return
    tab.dirty = {}
    tab.editCell = null
    ElMessage.info(t('database.msg.discarded'))
  }

  return {
    dataCellValue,
    startEditCell,
    cancelEditCell,
    commitEditCell,
    onEditCellKeydown,
    onEditCellBlur,
    setInsertCell,
    toggleSelectRow,
    startInsertRow,
    cancelInsertRow,
    saveInsertRow,
    saveDirtyRows,
    deleteSelectedRows,
    discardDirty,
  }
}
