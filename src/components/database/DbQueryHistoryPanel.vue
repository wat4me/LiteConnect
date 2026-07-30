<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QueryHistoryItem } from '@/domain/database/types'
import { formatHistoryTime } from '@/domain/database/dbFormat'
import {
  historyLogMeta,
  truncateHistorySql,
  type HistoryLogMeta,
} from '@/utils/database/queryHistoryLog'

const { t } = useI18n()

type HistoryStatusFilter = 'all' | 'success' | 'failed' | 'cancelled' | 'slow'

const props = defineProps<{
  history: QueryHistoryItem[]
  historyOnlyCurrent: boolean
  historyStatusFilter: HistoryStatusFilter
  connectionNameOf: (connectionId: string) => string
}>()

const emit = defineEmits<{
  'update:historyOnlyCurrent': [value: boolean]
  'update:historyStatusFilter': [value: HistoryStatusFilter]
  clearHistory: []
  applyHistory: [item: QueryHistoryItem]
}>()

type RowView = {
  item: QueryHistoryItem
  meta: HistoryLogMeta
  sqlPreview: string
  statusText: string
  scopeText: string
}

const rows = computed((): RowView[] =>
  props.history.map((item) => {
    const meta = historyLogMeta(item)
    let statusText = t('database.query.historyFilterSuccess')
    if (meta.status === 'failed') statusText = t('database.query.historyFilterFailed')
    else if (meta.status === 'cancelled') statusText = t('database.query.historyFilterCancelled')
    let scopeText = ''
    if (meta.scope === 'selection') scopeText = t('database.query.historyScopeSelection')
    else if (meta.scope === 'statement') scopeText = t('database.query.historyScopeStatement')
    else if (meta.scope === 'all') scopeText = t('database.query.historyScopeAll')
    else if (meta.scope === 'explain') scopeText = t('database.query.historyScopeExplain')
    return {
      item,
      meta,
      sqlPreview: truncateHistorySql(item.sql),
      statusText,
      scopeText,
    }
  }),
)
</script>

<template>
  <div class="history-panel-inline">
    <div class="history-head">
      <strong>{{ t('database.query.historyTitle') }}</strong>
      <button
        type="button"
        class="ui-btn ui-btn-xs ui-btn-danger"
        :disabled="history.length === 0"
        @click="emit('clearHistory')"
      >
        {{ t('database.query.clear') }}
      </button>
    </div>
    <div class="history-filter-row">
      <label class="history-filter-label">
        <input
          :checked="historyOnlyCurrent"
          type="checkbox"
          @change="emit('update:historyOnlyCurrent', ($event.target as HTMLInputElement).checked)"
        />
        {{ t('database.query.onlyCurrent') }}
      </label>
      <select
        class="ui-input ui-input-sm history-status-select"
        :value="historyStatusFilter"
        @change="emit('update:historyStatusFilter', ($event.target as HTMLSelectElement).value as HistoryStatusFilter)"
      >
        <option value="all">{{ t('database.query.historyFilterAll') }}</option>
        <option value="success">{{ t('database.query.historyFilterSuccess') }}</option>
        <option value="failed">{{ t('database.query.historyFilterFailed') }}</option>
        <option value="cancelled">{{ t('database.query.historyFilterCancelled') }}</option>
        <option value="slow">{{ t('database.query.historyFilterSlow') }}</option>
      </select>
    </div>
    <div class="history-list">
      <div v-if="rows.length === 0" class="history-empty">
        {{ t('database.query.historyEmpty') }}
      </div>
      <button
        v-for="row in rows"
        :key="row.item.id"
        type="button"
        class="history-item"
        :title="t('database.query.applyHistory')"
        @click="emit('applyHistory', row.item)"
      >
        <span class="history-meta">
          <span>{{ formatHistoryTime(row.item.at) }}</span>
          <span class="history-status" :class="row.meta.status">{{ row.statusText }}</span>
          <span v-if="row.meta.durationMs != null" class="history-ms">{{ row.meta.durationMs }}ms</span>
          <span v-if="row.meta.rowsLabel" class="history-rows">{{ row.meta.rowsLabel }}</span>
          <span v-if="row.scopeText" class="history-scope">{{ row.scopeText }}</span>
          <span v-if="row.meta.truncated" class="history-trunc">{{ t('database.query.historyTruncated') }}</span>
          <span v-if="row.meta.slow" class="history-slow">slow</span>
          <span v-if="row.item.connectionId" class="history-conn">{{ connectionNameOf(row.item.connectionId) }}</span>
          <span v-if="row.item.database" class="history-db">{{ row.item.database }}</span>
        </span>
        <span class="history-sql">{{ row.sqlPreview }}</span>
        <span v-if="row.meta.errorPreview" class="history-err">{{ row.meta.errorPreview }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.history-panel-inline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  flex-shrink: 0;
}

.history-filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.history-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.history-status-select {
  max-width: 110px;
}

.history-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.history-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary);
}

.history-item:hover {
  background: var(--hover-bg);
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.history-status {
  text-transform: uppercase;
  font-size: 10px;
  opacity: 0.85;
}

.history-status.failed {
  color: var(--danger, #f85149);
}

.history-status.cancelled {
  color: var(--text-secondary);
}

.history-status.success {
  color: var(--success, #3fb950);
}

.history-slow {
  color: var(--warning, #d29922);
  font-size: 10px;
}

.history-conn {
  padding: 0 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text-primary);
  font-weight: 600;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-db {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

      .history-sql {
  font-size: 12px;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.92;
}

.history-rows,
.history-scope,
.history-trunc {
  font-size: 10px;
  opacity: 0.9;
}

.history-trunc {
  color: var(--warning, #d29922);
}

.history-err {
  font-size: 11px;
  color: var(--danger, #f85149);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.9;
}
</style>
