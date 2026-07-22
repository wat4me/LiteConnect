<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { GridSort } from './types'
import {
  cellValue,
  formatCell,
  isBlobPlaceholder,
  isNullCell,
  sortIndicator,
} from './dbFormat'

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

function onHeaderClick(col: string) {
  emit('sort', col)
}

function onCellDblClick(row: Record<string, unknown>, col: string) {
  if (!props.copyable) return
  emit('copyCell', cellValue(row, col))
}
</script>

<template>
  <div class="grid-scroll">
    <table class="sheet">
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
        <tr v-for="(row, ri) in rows" :key="ri">
          <td class="rn">{{ rowNumberStart + ri }}</td>
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
      </tbody>
    </table>
    <div v-if="rows.length === 0" class="grid-empty">
      {{ filterActive ? t('database.grid.noMatch') : (emptyText ?? t('database.grid.emptyRows')) }}
    </div>
  </div>
</template>

<style scoped>
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

.sheet td.blob {
  font-style: italic;
  color: var(--text-secondary);
}

.cell-copyable {
  cursor: copy;
}

.grid-empty {
  padding: 24px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
