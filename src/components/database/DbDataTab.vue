<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DataTab } from './types'
import {
  formatCell,
  isBlobPlaceholder,
  sortIndicator,
} from './dbFormat'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    tab: DataTab
    connectionName: string
    connectionMeta: string
    /** When embedded in table workspace, parent shows path + panel tabs */
    hideBreadcrumb?: boolean
  }>(),
  { hideBreadcrumb: false },
)

const emit = defineEmits<{
  sort: [col: string]
  pageDelta: [delta: number]
  jumpPage: [raw: string | number]
  pageSize: [size: number]
  refresh: []
  startInsert: []
  saveDirty: []
  discardDirty: []
  deleteSelected: []
  copyResult: []
  exportCsv: []
  exportJson: []
  exportAll: []
  serverSearch: [value: string]
  toggleSelect: [rowIndex: number]
  startEdit: [rowIndex: number, col: string]
  editKeydown: [e: KeyboardEvent]
  editBlur: []
  setInsertCell: [col: string, value: string]
  saveInsert: []
  cancelInsert: []
}>()

function onServerSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    emit('serverSearch', props.tab.serverSearch)
  }
}

const dataDisplayRows = computed(() => {
  const tab = props.tab
  if (!tab.result) return [] as Array<{ row: Record<string, unknown>; index: number }>
  const columns = tab.result.columns
  const withIndex = tab.result.rows.map((row, index) => ({
    row: (tab.dirty[index] || row) as Record<string, unknown>,
    index,
  }))
  const q = tab.filter.trim().toLowerCase()
  if (!q) return withIndex
  return withIndex.filter(({ row }) =>
    columns.some((col) => {
      const v = row[col]
      if (v == null) return q === 'null'
      return String(v).toLowerCase().includes(q)
    }),
  )
})

function dataCellValue(rowIndex: number, col: string): unknown {
  const tab = props.tab
  const dirty = tab.dirty[rowIndex]
  if (dirty && col in dirty) return dirty[col]
  return tab.result?.rows[rowIndex]?.[col]
}

function isDataCellDirty(rowIndex: number, col: string): boolean {
  const tab = props.tab
  const dirty = tab.dirty[rowIndex]
  if (!dirty || !(col in dirty)) return false
  const orig = tab.result?.rows[rowIndex]?.[col]
  return String(dirty[col] ?? '') !== String(orig ?? '') || (dirty[col] == null) !== (orig == null)
}

const maxPage = computed(() => {
  const tab = props.tab
  if (!tab.result) return 1
  const mode = tab.result.totalMode || 'exact'
  if (mode === 'unknown') {
    return Math.max(1, tab.page + (tab.result.hasNext ? 1 : 0), Math.ceil(Math.max(tab.result.total, 1) / tab.pageSize))
  }
  return Math.max(1, Math.ceil(Math.max(tab.result.total, 1) / tab.pageSize))
})

const totalRowsLabel = computed(() => {
  const r = props.tab.result
  if (!r) return ''
  const mode = r.totalMode || 'exact'
  if (mode === 'estimated') return t('database.data.totalRowsEstimated', { n: r.total })
  if (mode === 'unknown') {
    return r.hasNext
      ? t('database.data.totalRowsUnknownMore', { n: r.total })
      : t('database.data.totalRowsUnknown', { n: r.total })
  }
  return t('database.data.totalRows', { n: r.total })
})

const nextDisabled = computed(() => {
  const tab = props.tab
  if (tab.loading || !tab.result) return true
  if (tab.result.hasNext === true) return false
  if (tab.result.hasNext === false) return true
  return tab.page * tab.pageSize >= tab.result.total
})

const dirtyCount = computed(() => Object.keys(props.tab.dirty).length)
</script>

<template>
  <div class="table-view">
    <div class="table-toolbar">
      <div class="toolbar-row primary">
        <div v-if="!hideBreadcrumb" class="breadcrumb">
          <span class="bc-conn" :title="connectionMeta">{{ connectionName }}</span>
          <span class="sep">/</span>
          <span>{{ tab.database }}</span>
          <span class="sep">/</span>
          <strong>{{ tab.table }}</strong>
          <span v-if="tab.pkColumns.length" class="tag pk-tag" :title="t('database.data.pkColumns')">
            PK {{ tab.pkColumns.join(', ') }}
          </span>
          <span v-else class="tag warn-tag" :title="t('database.data.noPkTitle')">{{ t('database.data.noPk') }}</span>
          <span v-if="tab.result" class="row-total">{{ totalRowsLabel }}</span>
        </div>
        <div v-else class="breadcrumb meta-only">
          <span v-if="tab.pkColumns.length" class="tag pk-tag" :title="t('database.data.pkColumns')">
            PK {{ tab.pkColumns.join(', ') }}
          </span>
          <span v-else class="tag warn-tag" :title="t('database.data.noPkTitle')">{{ t('database.data.noPk') }}</span>
          <span v-if="tab.result" class="row-total">{{ totalRowsLabel }}</span>
        </div>
        <div class="search-group">
          <label class="search-field" :title="t('database.data.serverSearchTitle')">
            <span class="search-label">{{ t('database.data.serverSearch') }}</span>
            <input
              v-model="tab.serverSearch"
              class="ui-input ui-input-sm search-input"
              type="search"
              :placeholder="t('database.data.serverSearchPlaceholder')"
              :disabled="tab.loading"
              @keydown="onServerSearchKey"
            />
          </label>
          <label class="search-field" :title="t('database.data.pageFilterTitle')">
            <span class="search-label">{{ t('database.data.pageFilter') }}</span>
            <input
              v-model="tab.filter"
              class="ui-input ui-input-sm search-input narrow"
              type="search"
              :placeholder="t('database.data.pageFilterPlaceholder')"
            />
          </label>
        </div>
      </div>

      <div class="toolbar-row secondary">
        <div class="tool-group pager">
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="tab.loading || tab.page <= 1"
            :title="t('database.data.prevPage')"
            @click="emit('pageDelta', -1)"
          >
            ‹
          </button>
          <span class="page-info page-jump">
            {{ t('database.data.pageOf') }}
            <input
              class="ui-input ui-input-sm page-input"
              type="number"
              min="1"
              :value="tab.page"
              :disabled="tab.loading"
              @change="emit('jumpPage', ($event.target as HTMLInputElement).value)"
              @keydown.enter="emit('jumpPage', ($event.target as HTMLInputElement).value)"
            />
            / {{ maxPage }}
          </span>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="nextDisabled"
            :title="t('database.data.nextPage')"
            @click="emit('pageDelta', 1)"
          >
            ›
          </button>
          <select
            class="ui-input ui-input-sm page-size-select"
            :value="tab.pageSize"
            :disabled="tab.loading"
            @change="emit('pageSize', Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="50">{{ t('database.data.perPage', { n: 50 }) }}</option>
            <option :value="100">{{ t('database.data.perPage', { n: 100 }) }}</option>
            <option :value="200">{{ t('database.data.perPage', { n: 200 }) }}</option>
            <option :value="500">{{ t('database.data.perPage', { n: 500 }) }}</option>
          </select>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="tab.loading || tab.saving"
            :title="t('database.data.refreshTitle')"
            @click="emit('refresh')"
          >
            {{ t('database.data.refresh') }}
          </button>
        </div>

        <div class="tool-group edit">
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!tab.result || tab.saving || tab.pkColumns.length === 0"
            :title="t('database.data.addRowTitle')"
            @click="emit('startInsert')"
          >
            {{ t('database.data.addRow') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="dirtyCount === 0 || tab.saving"
            :title="t('database.data.saveTitle')"
            @click="emit('saveDirty')"
          >
            {{ t('database.data.save') }}{{ dirtyCount ? ` (${dirtyCount})` : '' }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="dirtyCount === 0 || tab.saving"
            @click="emit('discardDirty')"
          >
            {{ t('database.data.discard') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm ui-btn-danger"
            :disabled="tab.selected.length === 0 || tab.saving || tab.pkColumns.length === 0"
            @click="emit('deleteSelected')"
          >
            {{ t('database.data.delete') }}
          </button>
        </div>

        <div class="tool-group export">
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!tab.result"
            :title="t('database.data.copyTitle')"
            @click="emit('copyResult')"
          >
            {{ t('database.data.copy') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!tab.result"
            :title="t('database.data.exportCsvTitle')"
            @click="emit('exportCsv')"
          >
            CSV
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="!tab.result"
            :title="t('database.data.exportJsonTitle')"
            @click="emit('exportJson')"
          >
            JSON
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="tab.loading"
            :title="t('database.data.exportAllTitle')"
            @click="emit('exportAll')"
          >
            {{ t('database.data.exportAll') }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="tab.loading" class="grid-empty">{{ t('database.data.loading') }}</div>
    <div v-else-if="tab.error" class="err-panel">{{ tab.error }}</div>
    <div v-else-if="tab.result" class="grid-scroll">
      <table class="sheet editable-sheet">
        <thead>
          <tr>
            <th class="rn sel">{{ t('database.data.selectCol') }}</th>
            <th class="rn">#</th>
            <th
              v-for="col in tab.result.columns"
              :key="col"
              class="sortable"
              :class="{ sorted: tab.sort?.col === col }"
              @click="emit('sort', col)"
            >
              {{ col }}{{ sortIndicator(tab.sort, col) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="tab.inserting" class="insert-row">
            <td class="rn sel"></td>
            <td class="rn">+</td>
            <td v-for="col in tab.result.columns" :key="'ins-' + col">
              <input
                class="cell-edit-input"
                :value="tab.inserting[col] == null ? '' : String(tab.inserting[col])"
                :placeholder="tab.inserting[col] == null ? 'NULL' : ''"
                @input="emit('setInsertCell', col, ($event.target as HTMLInputElement).value)"
              />
            </td>
          </tr>
          <tr v-if="tab.inserting" class="insert-actions-row">
            <td :colspan="tab.result.columns.length + 2">
              <button type="button" class="ui-btn ui-btn-sm" :disabled="tab.saving" @click="emit('saveInsert')">
                {{ t('database.data.confirmInsert') }}
              </button>
              <button type="button" class="ui-btn ui-btn-sm" :disabled="tab.saving" @click="emit('cancelInsert')">
                {{ t('database.data.cancel') }}
              </button>
            </td>
          </tr>
          <tr
            v-for="item in dataDisplayRows"
            :key="item.index"
            :class="{ dirty: !!tab.dirty[item.index], selected: tab.selected.includes(item.index) }"
          >
            <td class="rn sel">
              <input
                type="checkbox"
                :checked="tab.selected.includes(item.index)"
                @change="emit('toggleSelect', item.index)"
              />
            </td>
            <td class="rn">{{ (tab.page - 1) * tab.pageSize + item.index + 1 }}</td>
            <td
              v-for="col in tab.result.columns"
              :key="col"
              class="cell-editable"
              :class="{
                nul: dataCellValue(item.index, col) == null,
                dirty: isDataCellDirty(item.index, col),
                blob: isBlobPlaceholder(dataCellValue(item.index, col)),
                editing: tab.editCell?.rowIndex === item.index && tab.editCell?.col === col,
              }"
              @dblclick="emit('startEdit', item.index, col)"
            >
              <template v-if="tab.editCell?.rowIndex === item.index && tab.editCell?.col === col">
                <div class="cell-edit-wrap" @click.stop>
                  <input
                    class="cell-edit-input"
                    :value="tab.editDraft"
                    :disabled="tab.editAsNull"
                    autofocus
                    @input="tab.editDraft = ($event.target as HTMLInputElement).value"
                    @keydown="emit('editKeydown', $event)"
                    @blur="emit('editBlur')"
                  />
                  <label class="cell-null-label" @mousedown.prevent>
                    <input v-model="tab.editAsNull" type="checkbox" />
                    NULL
                  </label>
                </div>
              </template>
              <template v-else>
                {{ formatCell(dataCellValue(item.index, col)) }}
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="dataDisplayRows.length === 0 && !tab.inserting" class="grid-empty">
        {{ tab.filter.trim() ? t('database.data.noMatch') : t('database.data.emptyTable') }}
      </div>
    </div>
    <div v-if="tab.result && tab.pkColumns.length === 0" class="edit-hint">
      {{ t('database.data.noPkHint') }}
    </div>
    <div v-else-if="tab.result" class="edit-hint">
      {{ t('database.data.editHint') }}
    </div>
  </div>
</template>

<style scoped>
.table-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.table-toolbar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  flex-wrap: wrap;
}

.toolbar-row.primary {
  justify-content: space-between;
  gap: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.toolbar-row.secondary {
  gap: 10px 14px;
  padding-top: 7px;
  padding-bottom: 7px;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  min-width: 0;
  flex-wrap: wrap;
  flex: 1 1 auto;
}

.breadcrumb .bc-conn {
  font-weight: 600;
  color: var(--accent);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breadcrumb strong {
  color: var(--text-primary);
}

.breadcrumb .sep {
  opacity: 0.5;
}

.breadcrumb .tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
}

.row-total {
  margin-left: 4px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.search-group {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex: 0 1 auto;
  min-width: 0;
}

.search-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.search-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--text-secondary);
  opacity: 0.85;
  white-space: nowrap;
}

.search-input {
  width: min(220px, 28vw);
  min-width: 140px;
}

.search-input.narrow {
  width: min(150px, 20vw);
  min-width: 110px;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tool-group + .tool-group {
  padding-left: 12px;
  border-left: 1px solid var(--border-color);
}

.page-jump {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.page-input {
  width: 52px;
  text-align: center;
  padding-left: 4px;
  padding-right: 4px;
}

.page-size-select {
  width: auto;
  min-width: 80px;
}

.page-info {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 0 2px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .tool-group + .tool-group {
    padding-left: 0;
    border-left: none;
  }
}

.grid-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sheet {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--font-ui-sm, 12px);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.sheet th,
.sheet td {
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  padding: 6px 12px;
  text-align: left;
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.35;
}

.sheet th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-weight: 600;
  font-family: inherit;
  user-select: none;
  letter-spacing: 0.01em;
}

.sheet .rn {
  color: var(--text-secondary);
  background: var(--bg-secondary);
  position: sticky;
  left: 0;
  z-index: 2;
  text-align: right;
  min-width: 36px;
}

.sheet th.rn {
  z-index: 3;
}

.sheet tbody tr:hover td {
  background: var(--hover-bg);
}

.sheet tbody tr:hover td.rn {
  background: var(--bg-tertiary);
}

.sheet .nul {
  color: var(--text-secondary);
  font-style: italic;
}

.sheet th.sortable {
  cursor: pointer;
  user-select: none;
}

.sheet th.sortable:hover {
  color: var(--accent);
}

.sheet th.sorted {
  color: var(--accent);
}

.sheet .sel {
  width: 28px;
  text-align: center;
}

.sheet tr.dirty td {
  background: color-mix(in srgb, #ecc94b 12%, transparent);
}

.sheet tr.selected td {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.sheet td.dirty {
  box-shadow: inset 0 -2px 0 #ecc94b;
}

.sheet td.editing {
  padding: 2px 4px;
  background: var(--bg-secondary);
}

.sheet td.blob {
  font-style: italic;
  color: var(--text-secondary);
}

.cell-edit-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}

.cell-edit-input {
  width: 100%;
  min-width: 80px;
  height: var(--control-h-sm, 32px);
  padding: 0 8px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-ui-sm, 12px);
  font-family: var(--font-mono, inherit);
  box-sizing: border-box;
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.cell-null-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  user-select: none;
}

.insert-row td {
  background: color-mix(in srgb, #48bb78 10%, transparent);
}

.insert-actions-row td {
  padding: 6px 8px;
  background: color-mix(in srgb, #48bb78 8%, transparent);
}

.edit-hint {
  flex-shrink: 0;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
}

.pk-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, #63b3ed 20%, transparent);
  color: #63b3ed;
}

.warn-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, #ecc94b 20%, transparent);
  color: #d69e2e;
}

.grid-empty {
  padding: 24px;
  color: var(--text-secondary);
  font-size: 13px;
}

.err-panel {
  margin: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border-color));
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: var(--font-ui-sm, 12px);
  white-space: pre-wrap;
  font-family: var(--font-mono, 'Cascadia Code', Consolas, monospace);
}
</style>
