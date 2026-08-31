<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DataTab } from '@/domain/database/types'
import {
  formatCell,
  isBlobPlaceholder,
  sortIndicator,
} from '@/domain/database/dbFormat'
import { quoteIdent, sqlLiteral, type SqlDialect } from '@/utils/database/dbSql'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    tab: DataTab
    connectionName: string
    connectionMeta: string
    /** When embedded in table workspace, parent shows path + panel tabs */
    hideBreadcrumb?: boolean
    /** SQL dialect for building WHERE from cell values */
    dialect?: SqlDialect
  }>(),
  { hideBreadcrumb: false, dialect: 'mysql' },
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
  whereFilter: [value: string]
  toggleSelect: [rowIndex: number]
  startEdit: [rowIndex: number, col: string]
  editKeydown: [e: KeyboardEvent]
  editBlur: []
  setInsertCell: [col: string, value: string]
  saveInsert: []
  cancelInsert: []
}>()

const moreOpen = ref(false)
const moreMenuRef = ref<HTMLElement | null>(null)
const moreBtnRef = ref<HTMLButtonElement | null>(null)

type CellMenuState = {
  x: number
  y: number
  col: string
  value: unknown
}
const cellMenu = ref<CellMenuState | null>(null)

/**
 * Column widths:
 * - Auto-fit from header + current page cell text length (monospace estimate)
 * - User drag overrides auto until the result set identity changes
 */
const userColWidths = ref<Record<string, number>>({})
const autoColWidths = ref<Record<string, number>>({})
const MIN_COL_W = 48
const MAX_COL_W = 420
/** ~11px mono: latin ~6.6px, CJK ~11px — use mixed estimate */
const CHAR_W = 6.8
const CELL_PAD = 20 // horizontal padding + sort/pk chrome
/** Sample at most this many rows for width (perf on large pages) */
const WIDTH_SAMPLE_ROWS = 80

let resizeState: { col: string; startX: number; startW: number } | null = null
/** Result fingerprint last used for auto widths — drop user overrides on new load */
let lastWidthKey = ''

function measureTextWidth(text: string): number {
  if (!text) return 0
  let w = 0
  for (const ch of text) {
    // Full-width / CJK roughly double mono cell
    const code = ch.codePointAt(0) || 0
    w += code > 0xff ? CHAR_W * 1.65 : CHAR_W
  }
  return w
}

function estimateColWidth(col: string, result: NonNullable<DataTab['result']>): number {
  let maxCharsVisual = measureTextWidth(col) + (props.tab.pkColumns.includes(col) ? 14 : 0)
  const rows = result.rows
  const n = Math.min(rows.length, WIDTH_SAMPLE_ROWS)
  for (let i = 0; i < n; i++) {
    const raw = formatCell(rows[i]?.[col])
    // Cap per-cell sample so one huge JSON doesn't force max always early
    const sample = raw.length > 80 ? raw.slice(0, 80) : raw
    const w = measureTextWidth(sample)
    if (w > maxCharsVisual) maxCharsVisual = w
  }
  const px = Math.ceil(maxCharsVisual + CELL_PAD)
  // Prefer slightly roomy for tiny int columns, but keep short
  return Math.min(MAX_COL_W, Math.max(MIN_COL_W, px))
}

function resultWidthKey(result: NonNullable<DataTab['result']> | null | undefined): string {
  if (!result) return ''
  // page + columns + first/last row hints so page turn recalculates content
  const cols = result.columns.join('\0')
  const r0 = result.rows[0]
  const rN = result.rows[result.rows.length - 1]
  const tip = r0
    ? result.columns.map((c) => formatCell(r0[c]).slice(0, 24)).join('|')
    : ''
  const tipN = rN
    ? result.columns.map((c) => formatCell(rN[c]).slice(0, 12)).join('|')
    : ''
  return `${props.tab.id}\0${props.tab.page}\0${result.rows.length}\0${cols}\0${tip}\0${tipN}`
}

function recomputeAutoWidths() {
  const result = props.tab.result
  if (!result) {
    autoColWidths.value = {}
    return
  }
  const key = resultWidthKey(result)
  if (key !== lastWidthKey) {
    // New page / query result: drop manual sizes so auto-fit applies again
    userColWidths.value = {}
    lastWidthKey = key
  }
  const next: Record<string, number> = {}
  for (const col of result.columns) {
    next[col] = estimateColWidth(col, result)
  }
  autoColWidths.value = next
}

watch(
  () => resultWidthKey(props.tab.result),
  () => {
    recomputeAutoWidths()
  },
  { immediate: true },
)

function onWhereFilterKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    emit('whereFilter', props.tab.whereFilter)
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    if (!props.tab.whereFilter.trim()) return
    props.tab.whereFilter = ''
    emit('whereFilter', '')
  }
}

function colWidth(col: string): number {
  if (userColWidths.value[col] != null) return userColWidths.value[col]
  return autoColWidths.value[col] ?? MIN_COL_W + 40
}

function onResizeStart(e: MouseEvent, col: string) {
  e.preventDefault()
  e.stopPropagation()
  resizeState = { col, startX: e.clientX, startW: colWidth(col) }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!resizeState) return
  const next = Math.min(
    MAX_COL_W,
    Math.max(MIN_COL_W, resizeState.startW + (e.clientX - resizeState.startX)),
  )
  userColWidths.value = { ...userColWidths.value, [resizeState.col]: next }
}

function onResizeEnd() {
  resizeState = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
}

function openCellMenu(e: MouseEvent, col: string, value: unknown) {
  e.preventDefault()
  moreOpen.value = false
  cellMenu.value = { x: e.clientX, y: e.clientY, col, value }
}

function closeCellMenu() {
  cellMenu.value = null
}

function applyCellWhere(op: 'eq' | 'ne' | 'is_null' | 'is_not_null') {
  const m = cellMenu.value
  if (!m) return
  const dialect = props.dialect || 'mysql'
  const col = quoteIdent(m.col, dialect)
  let expr = ''
  if (op === 'is_null' || (op === 'eq' && m.value == null)) {
    expr = `${col} IS NULL`
  } else if (op === 'is_not_null' || (op === 'ne' && m.value == null)) {
    expr = `${col} IS NOT NULL`
  } else if (op === 'eq') {
    expr = `${col} = ${sqlLiteral(m.value, dialect)}`
  } else {
    expr = `${col} <> ${sqlLiteral(m.value, dialect)}`
  }
  props.tab.whereFilter = expr
  emit('whereFilter', expr)
  closeCellMenu()
}

function toggleMore() {
  moreOpen.value = !moreOpen.value
  cellMenu.value = null
}

function runExport(kind: 'copy' | 'csv' | 'json' | 'all') {
  moreOpen.value = false
  if (kind === 'copy') emit('copyResult')
  else if (kind === 'csv') emit('exportCsv')
  else if (kind === 'json') emit('exportJson')
  else emit('exportAll')
}

function onDocPointerDown(e: MouseEvent) {
  const t = e.target as Node
  if (moreOpen.value) {
    if (!moreMenuRef.value?.contains(t) && !moreBtnRef.value?.contains(t)) {
      moreOpen.value = false
    }
  }
  if (cellMenu.value) {
    const menu = document.querySelector('.db-cell-menu')
    if (menu && !menu.contains(t)) closeCellMenu()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocPointerDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointerDown)
  onResizeEnd()
})

const dataDisplayRows = computed(() => {
  const tab = props.tab
  if (!tab.result) return [] as Array<{ row: Record<string, unknown>; index: number }>
  // No in-page filter: use Ctrl+F for text search in the grid.
  return tab.result.rows.map((row, index) => ({
    row: (tab.dirty[index] || row) as Record<string, unknown>,
    index,
  }))
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

const prevPageDisabled = computed(() => props.tab.loading || props.tab.page < 2)

const cellMenuPreview = computed(() => {
  const m = cellMenu.value
  if (!m) return ''
  if (m.value == null) return 'NULL'
  const s = String(m.value)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
})
</script>

<template>
  <div class="table-view">
    <div class="table-toolbar">
      <div class="toolbar-row single">
        <!-- meta: pk + row count -->
        <div class="meta-strip">
          <template v-if="!hideBreadcrumb">
            <span class="bc-conn" :title="connectionMeta">{{ connectionName }}</span>
            <span class="sep">/</span>
            <span>{{ tab.database }}</span>
            <span class="sep">/</span>
            <strong>{{ tab.table }}</strong>
          </template>
          <span
            v-if="tab.pkColumns.length"
            class="tag pk-tag"
            :title="t('database.data.pkColumnsTitle', { cols: tab.pkColumns.join(', ') })"
          >
            <AppIcon name="key" size="xs" class="pk-icon" />
            {{ t('database.data.pkLabel') }} {{ tab.pkColumns.join(', ') }}
          </span>
          <span v-else class="tag warn-tag" :title="t('database.data.noPkTitle')">{{ t('database.data.noPk') }}</span>
          <span v-if="tab.result" class="row-total">{{ totalRowsLabel }}</span>
        </div>

        <!-- pager -->
        <div class="tool-group pager">
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :disabled="prevPageDisabled"
            :title="t('database.data.prevPage')"
            @click="emit('pageDelta', -1)"
          >
            ‹
          </button>
          <span class="page-info page-jump">
            <span class="page-of-label">{{ t('database.data.pageOf') }}</span>
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
            class="ui-btn ui-btn-xs"
            :disabled="nextDisabled"
            :title="t('database.data.nextPage')"
            @click="emit('pageDelta', 1)"
          >
            ›
          </button>
          <select
            class="ui-select ui-input-sm page-size-select"
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
            class="ui-btn ui-btn-xs"
            :disabled="tab.loading || tab.saving"
            :title="t('database.data.refreshTitle')"
            @click="emit('refresh')"
          >
            {{ t('database.data.refresh') }}
          </button>
        </div>

        <!-- WHERE only; in-page text search → Ctrl+F -->
        <div class="search-group">
          <input
            v-model="tab.whereFilter"
            class="ui-input ui-input-sm search-input where-input"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :title="t('database.data.whereFilterTitle')"
            :placeholder="t('database.data.whereFilterPlaceholder')"
            :disabled="tab.loading"
            :aria-label="t('database.data.whereFilter')"
            @keydown="onWhereFilterKey"
          />
        </div>

        <!-- edit actions -->
        <div class="tool-group edit" :class="{ 'has-dirty': dirtyCount !== 0 }">
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :disabled="!tab.result || tab.saving || tab.pkColumns.length === 0"
            :title="t('database.data.addRowTitle')"
            @click="emit('startInsert')"
          >
            {{ t('database.data.addRow') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :class="{ 'is-dirty-action': dirtyCount !== 0 }"
            :disabled="dirtyCount === 0 || tab.saving"
            :title="t('database.data.saveTitle')"
            @click="emit('saveDirty')"
          >
            {{ t('database.data.save') }}{{ dirtyCount ? ` (${dirtyCount})` : '' }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :disabled="dirtyCount === 0 || tab.saving"
            @click="emit('discardDirty')"
          >
            {{ t('database.data.discard') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-xs ui-btn-danger"
            :disabled="tab.selected.length === 0 || tab.saving || tab.pkColumns.length === 0"
            @click="emit('deleteSelected')"
          >
            {{ t('database.data.delete') }}
          </button>
        </div>

        <!-- export overflow -->
        <div class="tool-group more-wrap">
          <button
            ref="moreBtnRef"
            type="button"
            class="ui-btn ui-btn-xs"
            :title="t('database.data.moreActions')"
            :disabled="!tab.result && !tab.loading"
            @click="toggleMore"
          >
            <AppIcon name="more" size="sm" />
          </button>
          <div v-if="moreOpen" ref="moreMenuRef" class="more-menu" role="menu">
            <button type="button" role="menuitem" :disabled="!tab.result" @click="runExport('copy')">
              {{ t('database.data.copy') }}
            </button>
            <button type="button" role="menuitem" :disabled="!tab.result" @click="runExport('csv')">
              CSV
            </button>
            <button type="button" role="menuitem" :disabled="!tab.result" @click="runExport('json')">
              JSON
            </button>
            <button type="button" role="menuitem" :disabled="tab.loading" @click="runExport('all')">
              {{ t('database.data.exportAll') }}
            </button>
          </div>
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
              :class="{ sorted: tab.sort?.col === col, pk: tab.pkColumns.includes(col) }"
              :style="{ width: colWidth(col) + 'px', minWidth: colWidth(col) + 'px', maxWidth: colWidth(col) + 'px' }"
              :title="tab.pkColumns.includes(col) ? t('database.data.pkColumnTitle', { col }) : col"
              @click="emit('sort', col)"
            >
              <span class="th-inner">
                <AppIcon v-if="tab.pkColumns.includes(col)" name="key" size="xs" class="col-pk-icon" />
                <span class="th-label">{{ col }}{{ sortIndicator(tab.sort, col) }}</span>
              </span>
              <span
                class="col-resizer"
                title=""
                @mousedown="onResizeStart($event, col)"
                @click.stop
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="tab.inserting" class="insert-row">
            <td class="rn sel"></td>
            <td class="rn">+</td>
            <td
              v-for="col in tab.result.columns"
              :key="'ins-' + col"
              :style="{ width: colWidth(col) + 'px', minWidth: colWidth(col) + 'px', maxWidth: colWidth(col) + 'px' }"
            >
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
              :style="{ width: colWidth(col) + 'px', minWidth: colWidth(col) + 'px', maxWidth: colWidth(col) + 'px' }"
              @dblclick="emit('startEdit', item.index, col)"
              @contextmenu="openCellMenu($event, col, dataCellValue(item.index, col))"
            >
              <template v-if="tab.editCell?.rowIndex === item.index && tab.editCell?.col === col">
                <div class="cell-edit-wrap" @click.stop>
                  <input
                    class="cell-edit-input"
                    :value="tab.editDraft"
                    autofocus
                    :title="t('database.data.editNullHint')"
                    @input="tab.editDraft = ($event.target as HTMLInputElement).value"
                    @keydown="emit('editKeydown', $event)"
                    @blur="emit('editBlur')"
                  />
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
        {{ t('database.data.emptyTable') }}
      </div>
    </div>

    <!-- only show when no PK (action-blocking); hide everyday edit tip -->
    <div v-if="tab.result && tab.pkColumns.length === 0" class="edit-hint warn">
      {{ t('database.data.noPkHint') }}
    </div>

    <!-- cell context menu: filter by value -->
    <Teleport to="body">
      <div
        v-if="cellMenu"
        class="db-cell-menu"
        :style="{ left: cellMenu.x + 'px', top: cellMenu.y + 'px' }"
        role="menu"
        @mousedown.stop
      >
        <div class="db-cell-menu-head" :title="String(cellMenu.col)">
          {{ cellMenu.col }}
          <span class="db-cell-menu-val">{{ cellMenuPreview }}</span>
        </div>
        <button type="button" role="menuitem" @click="applyCellWhere('eq')">
          {{ t('database.data.filterEq') }}
        </button>
        <button type="button" role="menuitem" @click="applyCellWhere('ne')">
          {{ t('database.data.filterNe') }}
        </button>
        <button type="button" role="menuitem" @click="applyCellWhere('is_null')">
          {{ t('database.data.filterIsNull') }}
        </button>
        <button type="button" role="menuitem" @click="applyCellWhere('is_not_null')">
          {{ t('database.data.filterIsNotNull') }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.table-view {
  flex: 1;
  min-height: 0;
  min-width: 0;
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

.toolbar-row.single {
  --tb-h: 26px;
  --tb-fs: 11px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  flex-wrap: nowrap;
  min-width: 0;
}

.meta-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex-wrap: nowrap;
  flex: 0 1 auto;
  overflow: hidden;
  font-size: 12px;
}

.meta-strip .bc-conn {
  font-weight: 600;
  color: var(--accent);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-strip strong {
  color: var(--text-primary);
}

.meta-strip .sep {
  opacity: 0.5;
}

.meta-strip .tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
}

.row-total {
  opacity: 0.8;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.search-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 140px;
  min-width: 72px;
}

.where-input {
  flex: 1 1 140px;
  width: auto;
  min-width: 72px;
  max-width: 480px;
  font-family: var(--db-font-family, var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace));
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.tool-group + .tool-group {
  padding-left: 8px;
  border-left: 1px solid var(--border-color);
}

.page-jump {
  display: inline-flex;
  align-items: center;
  height: var(--tb-h);
  gap: 3px;
}

.page-info {
  font-size: 12px;
  line-height: var(--tb-h);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* One metric for buttons / number / native <select> — global .ui-input
 * line-height is tied to --control-h (36px) and makes 100/页 sit off the
 * 刷新 baseline. Beat .ui-select.ui-input-sm (32px) with higher specificity.
 * Toolbar actions use ui-btn-xs (26px / 11px) like the query result bar. */
.toolbar-row :deep(.ui-btn-xs),
.toolbar-row :deep(.ui-input-sm),
.toolbar-row :deep(select.ui-select.ui-input-sm) {
  box-sizing: border-box;
  height: var(--tb-h);
  min-height: var(--tb-h);
  max-height: var(--tb-h);
  font-size: var(--tb-fs);
  font-weight: 500;
  line-height: calc(var(--tb-h) - 2px);
  flex-shrink: 0;
}

.toolbar-row :deep(.ui-btn-xs) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  line-height: 1;
}

.page-input {
  width: 44px;
  text-align: center;
  padding: 0 2px;
}

.page-input::-webkit-outer-spin-button,
.page-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.toolbar-row select.ui-select.ui-input-sm.page-size-select {
  width: auto;
  min-width: 4.75em;
  padding: 0 22px 0 8px;
  background-position: right 6px center;
  vertical-align: middle;
}

.tool-group.edit.has-dirty .is-dirty-action {
  border-color: color-mix(in srgb, #ecc94b 55%, var(--border-color));
  color: #d69e2e;
  font-weight: 600;
}

.more-wrap {
  position: relative;
  border-left: 1px solid var(--border-color);
  padding-left: 8px;
}

.more-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 40;
  min-width: 132px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.more-menu button {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.more-menu button:hover:not(:disabled) {
  background: var(--hover-bg);
}

.more-menu button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@container db-table (max-width: 880px) {
  .row-total {
    display: none;
  }
  .search-group,
  .where-input {
    flex-basis: 80px;
    min-width: 56px;
    max-width: 220px;
  }
}

@container db-table (max-width: 720px) {
  .meta-strip {
    display: none;
  }
  .page-of-label {
    display: none;
  }
  .page-size-select {
    display: none;
  }
  .tool-group + .tool-group,
  .more-wrap {
    padding-left: 4px;
    border-left: none;
  }
}

@container db-table (max-width: 560px) {
  .search-group,
  .where-input {
    flex-basis: 48px;
    min-width: 48px;
  }
  .toolbar-row :deep(.ui-btn-xs) {
    padding: 0 5px;
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
  font-size: var(--db-font-size, 13px);
  font-family: var(--db-font-family, var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace));
  table-layout: fixed;
}

.sheet th,
.sheet td {
  border-right: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
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
  /* sticky + resizer handle */
  overflow: visible;
}

.sheet th.sortable {
  cursor: pointer;
  position: sticky;
}

.th-inner {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  overflow: hidden;
}

.th-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  z-index: 2;
}

.col-resizer:hover,
.col-resizer:active {
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}

.sheet th.pk {
  color: #63b3ed;
}

.col-pk-icon {
  flex-shrink: 0;
  opacity: 0.95;
}

.sheet .rn {
  color: var(--text-secondary);
  background: var(--bg-secondary);
  position: sticky;
  left: 0;
  z-index: 2;
  text-align: right;
  min-width: 36px;
  width: 36px;
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

.sheet th.sortable:hover {
  color: var(--accent);
}

.sheet th.sorted {
  color: var(--accent);
}

.sheet .sel {
  width: 28px;
  min-width: 28px;
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
  min-width: 100px;
}

.cell-edit-input {
  width: 100%;
  min-width: 60px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--db-font-size, 13px);
  font-family: var(--db-font-family, var(--font-mono, inherit));
  box-sizing: border-box;
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-bg);
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
  padding: 4px 10px;
  font-size: 10px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
}

.edit-hint.warn {
  color: #d69e2e;
  background: color-mix(in srgb, #ecc94b 10%, transparent);
}

.pk-tag {
  background: color-mix(in srgb, #63b3ed 20%, transparent);
  color: #63b3ed;
}

.pk-icon {
  flex-shrink: 0;
}

.warn-tag {
  background: color-mix(in srgb, #ecc94b 20%, transparent);
  color: #d69e2e;
}

.grid-empty {
  padding: 20px;
  color: var(--text-secondary);
  font-size: 12px;
}

.err-panel {
  padding: 12px 14px;
  color: #e53e3e;
  font-size: 12px;
}
</style>

<style>
/* Teleported cell menu (not scoped) */
.db-cell-menu {
  position: fixed;
  z-index: 5000;
  min-width: 180px;
  max-width: 280px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.db-cell-menu-head {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.db-cell-menu-val {
  display: block;
  margin-top: 2px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--db-font-family, var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace));
  overflow: hidden;
  text-overflow: ellipsis;
}

.db-cell-menu button {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.db-cell-menu button:hover {
  background: var(--hover-bg);
}
</style>
