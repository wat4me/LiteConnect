<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GridSort } from '@/domain/database/types'
import {
  cellValue,
  formatCell,
  isBlobPlaceholder,
  isNullCell,
  sortIndicator,
} from '@/domain/database/dbFormat'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    columns: string[]
    rows: Array<Record<string, unknown>>
    sort?: GridSort
    emptyText?: string
    filterActive?: boolean
    /** 行号起始（默认 1；数据页可用分页偏移） */
    rowNumberStart?: number
    copyable?: boolean
  }>(),
  {
    sort: null,
    emptyText: undefined,
    filterActive: false,
    rowNumberStart: 1,
    copyable: true,
  },
)

const emit = defineEmits<{
  sort: [col: string]
  copyCell: [value: unknown]
}>()

const scrollRef = ref<HTMLElement | null>(null)
const tableRef = ref<HTMLTableElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(600)
const rowHeight = ref(31)
const columnWidths = ref<number[]>([])
const virtual = computed(() => props.rows.length > 100)
const start = computed(() => virtual.value ? Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - 8) : 0)
const end = computed(() => virtual.value ? Math.min(props.rows.length, Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight.value) + 8) : props.rows.length)
const visibleRows = computed(() => props.rows.slice(start.value, end.value))
const tableStyle = computed(() => virtual.value && columnWidths.value.length ? {
  tableLayout: 'fixed' as const, width: columnWidths.value.reduce((sum, width) => sum + width, 0) + 'px',
} : undefined)
let observer: ResizeObserver | null = null
let observedRow: HTMLElement | null = null
let frame = 0
let measuredFont = ''
let context: CanvasRenderingContext2D | null = null

function measureColumns() {
  const table = tableRef.value
  if (!table || !virtual.value) return
  context ??= document.createElement('canvas').getContext('2d')
  if (!context) return
  const font = getComputedStyle(table).font
  measuredFont = font
  context.font = font
  const measure = (text: string) => context!.measureText(text.slice(0, 512)).width
  const numberWidth = Math.max(48, measure(String(props.rowNumberStart + props.rows.length)) + 26)
  columnWidths.value = [numberWidth, ...props.columns.map(col => {
    let width = measure(col) + 48
    // Widths stay stable while scrolling; sampling bounds work on wide result sets.
    for (const row of props.rows.slice(0, 80)) width = Math.max(width, measure(formatCell(cellValue(row, col))) + 26)
    return Math.ceil(Math.min(360, Math.max(72, width)))
  })]
}

function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const el = scrollRef.value
    if (!el) return
    const measured = tableRef.value?.querySelector<HTMLElement>('tbody tr[data-row-index]')?.getBoundingClientRect().height
    if (measured && Math.abs(measured - rowHeight.value) > 0.1) {
      const adjusted = el.scrollTop * measured / rowHeight.value
      rowHeight.value = measured
      void nextTick(() => { if (scrollRef.value === el) { el.scrollTop = adjusted; scrollTop.value = el.scrollTop } })
    }
    viewportHeight.value = el.clientHeight
    scrollTop.value = el.scrollTop
    if (tableRef.value && measuredFont !== getComputedStyle(tableRef.value).font) measureColumns()
  })
}

function observeRow() {
  const row = tableRef.value?.querySelector<HTMLElement>('tbody tr[data-row-index]') ?? null
  if (observedRow === row) return
  if (observedRow) observer?.unobserve(observedRow)
  observedRow = row
  if (row) observer?.observe(row)
}

watch(() => [props.rows, props.rows.length, props.columns, props.rowNumberStart], async () => {
  scrollTop.value = 0
  if (scrollRef.value) scrollRef.value.scrollTop = 0
  await nextTick()
  measureColumns()
  scheduleMeasure()
}, { flush: 'post' })

onMounted(() => {
  observer = new ResizeObserver(scheduleMeasure)
  if (scrollRef.value) observer.observe(scrollRef.value)
  observeRow()
  measureColumns()
  scheduleMeasure()
})
onUpdated(observeRow)
onBeforeUnmount(() => { if (frame) cancelAnimationFrame(frame); observer?.disconnect() })

function onHeaderClick(col: string) {
  emit('sort', col)
}

function onCellDblClick(row: Record<string, unknown>, col: string) {
  if (!props.copyable) return
  emit('copyCell', cellValue(row, col))
}
</script>

<template>
  <div ref="scrollRef" class="grid-scroll" :data-item-count="rows.length" @scroll.passive="scheduleMeasure">
    <table ref="tableRef" class="sheet" :style="tableStyle" :aria-rowcount="rows.length + 1">
      <colgroup v-if="virtual && columnWidths.length">
        <col v-for="(width, index) in columnWidths" :key="index" :style="{ width: width + 'px' }" />
      </colgroup>
      <thead>
        <tr>
          <th class="rn">#</th>
          <th
            v-for="col in columns"
            :key="col"
            class="sortable"
            :class="{ sorted: sort?.col === col }"
            @click="onHeaderClick(col)"
          >
            {{ col }}{{ sortIndicator(sort, col) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="virtual && start > 0" class="grid-spacer" aria-hidden="true"><td :colspan="columns.length + 1" :style="{ height: start * rowHeight + 'px' }"></td></tr>
        <tr v-for="(row, ri) in visibleRows" :key="start + ri" :data-row-index="start + ri" :aria-rowindex="start + ri + 2">
          <td class="rn">{{ rowNumberStart + start + ri }}</td>
          <td
            v-for="col in columns"
            :key="col"
            :class="{
              'cell-copyable': copyable,
              nul: isNullCell(row, col),
              blob: isBlobPlaceholder(cellValue(row, col)),
            }"
            :title="formatCell(cellValue(row, col)) + (copyable ? t('database.grid.dblClickCopy') : '')"
            @dblclick="onCellDblClick(row, col)"
          >
            {{ formatCell(cellValue(row, col)) }}
          </td>
        </tr>
        <tr v-if="virtual && end < rows.length" class="grid-spacer" aria-hidden="true"><td :colspan="columns.length + 1" :style="{ height: (rows.length - end) * rowHeight + 'px' }"></td></tr>
      </tbody>
    </table>
    <div v-if="rows.length === 0" class="grid-empty">
      {{ filterActive ? t('database.grid.noMatch') : (emptyText ?? t('database.grid.emptyRows')) }}
    </div>
  </div>
</template>

<style scoped>
.grid-scroll {
  overflow-anchor: none;
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

.sheet td.blob {
  font-style: italic;
  color: var(--text-secondary);
}

.sheet .grid-spacer td { padding: 0; border: 0; font-size: 0; line-height: 0; }

.cell-copyable {
  cursor: copy;
}

.grid-empty {
  padding: 24px;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
