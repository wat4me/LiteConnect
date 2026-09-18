import { ElMessage } from 'element-plus/es/components/message/index'
import type { ComputedRef } from 'vue'
import { filterRows, sortRows } from '@/utils/database/dbSql'
import {
  downloadTextFile,
  formatCell,
  resultToCsv,
  resultToTsv,
} from '@/domain/database/dbFormat'
import { t } from '../../i18n'
import type { WsTab } from '@/domain/database/types'

export function useDbResultExport(deps: {
  activeTab: ComputedRef<WsTab | null>
}) {
  async function copyText(text: string, okMsg = t('database.msg.copied')) {
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success(okMsg)
    } catch {
      ElMessage.error(t('database.msg.copyFailed'))
    }
  }

  function activeExportRows(): { columns: string[]; rows: Record<string, unknown>[]; name: string } | null {
    const tab = deps.activeTab.value
    if (!tab) return null
    if (tab.kind === 'query' && tab.result?.hasResultSet) {
      let rows = tab.result.rows as Array<Record<string, unknown>>
      if (tab.sort) rows = sortRows(rows, tab.sort.col, tab.sort.dir)
      rows = filterRows(rows, tab.result.columns, tab.filter)
      return { columns: tab.result.columns, rows, name: 'query' }
    }
    if (tab.kind === 'data' && tab.result) {
      const columns = tab.result.columns
      const rows = tab.result.rows.map((row, index) => (tab.dirty[index] || row) as Record<string, unknown>)
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

  return {
    exportActiveResultCsv,
    exportActiveResultJson,
    copyActiveResult,
    copyResultCell,
  }
}
