<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QueryHistoryItem, QueryTab } from '@/domain/database/types'
import DbResultGrid from './DbResultGrid.vue'
import DbQueryHistoryPanel from './DbQueryHistoryPanel.vue'
import {
  displayRowsForOutput,
  resolveOutputPanel,
  type QueryOutputPanel,
} from '@/utils/database/queryOutputPanel'
import { nextOutputPanel, outputPanelDomIds } from '@/utils/database/queryUiController'
import { filterRows, sortRows } from '@/utils/database/dbSql'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

type HistoryStatusFilter = 'all' | 'success' | 'failed' | 'cancelled' | 'slow'

const props = defineProps<{
  tab: QueryTab
  activePanel: QueryOutputPanel
  history: QueryHistoryItem[]
  historyOnlyCurrent: boolean
  historyStatusFilter: HistoryStatusFilter
  connectionNameOf: (connectionId: string) => string
}>()

const emit = defineEmits<{
  'update:activePanel': [panel: QueryOutputPanel]
  copyResult: []
  exportCsv: []
  exportJson: []
  copyCell: [value: unknown]
  retry: []
  sort: [col: string]
  'update:historyOnlyCurrent': [value: boolean]
  'update:historyStatusFilter': [value: HistoryStatusFilter]
  clearHistory: []
  applyHistory: [item: QueryHistoryItem]
}>()

const isPlan = computed(() => props.tab.outputKind === 'plan')

const queryDisplayRows = computed(() => {
  if (!props.tab.result?.hasResultSet) return []
  return displayRowsForOutput({
    outputKind: props.tab.outputKind ?? 'result',
    hasResultSet: true,
    rows: props.tab.result.rows as Array<Record<string, unknown>>,
    columns: props.tab.result.columns,
    filter: props.tab.filter,
    sort: props.tab.sort,
    sortRows,
    filterRows,
  })
})

/** Plan grid never applies local result filter (stale filter isolation). */
const planDisplayRows = computed(() => {
  if (!props.tab.result?.hasResultSet) return []
  return displayRowsForOutput({
    outputKind: 'plan',
    hasResultSet: true,
    rows: props.tab.result.rows as Array<Record<string, unknown>>,
    columns: props.tab.result.columns,
    filter: props.tab.filter,
    sort: props.tab.sort,
    sortRows,
    filterRows,
  })
})

const showResultGrid = computed(
  () => !!props.tab.result?.hasResultSet && !isPlan.value,
)
const showPlanGrid = computed(
  () => !!props.tab.result?.hasResultSet && isPlan.value,
)
const truncated = computed(() => !!props.tab.result?.truncated)
const panelIds = computed(() => outputPanelDomIds(props.tab.id))

function setPanel(panel: QueryOutputPanel) {
  emit('update:activePanel', panel)
}

function onTablistKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const order: QueryOutputPanel[] = ['result', 'messages', 'plan', 'history']
  let next: QueryOutputPanel = props.activePanel
  if (e.key === 'Home') next = order[0]
  else if (e.key === 'End') next = order[order.length - 1]
  else next = nextOutputPanel(props.activePanel, e.key === 'ArrowRight' ? 1 : -1)
  setPanel(next)
  void nextTick(() => {
    const el = document.getElementById(panelIds.value.tabs[next])
    el?.focus()
  })
}

/** Auto-select panel after query lifecycle changes (keeps history sticky until next event). */
watch(
  () =>
    [
      props.tab.error,
      props.tab.result,
      props.tab.outputKind,
      props.tab.loading,
    ] as const,
  (
    curr: readonly [string, unknown, unknown, boolean],
    prev: readonly [string, unknown, unknown, boolean] | undefined
  ) => {
    if (props.tab.loading) return
    const wasLoading = prev ? prev[3] : false
    // Only auto-switch when a run just finished or error/result identity changed after load
    if (!wasLoading && prev && curr[0] === prev[0] && curr[1] === prev[1] && curr[2] === prev[2]) {
      return
    }
    let event: 'query-success' | 'query-error' | 'explain-success' | 'explain-error' | 'idle' =
      'idle'
    if (props.tab.error) {
      event = props.tab.outputKind === 'plan' ? 'explain-error' : 'query-error'
    } else if (props.tab.result) {
      event = props.tab.outputKind === 'plan' ? 'explain-success' : 'query-success'
    }
    const next = resolveOutputPanel({
      outputKind: props.tab.outputKind ?? null,
      hasError: !!props.tab.error,
      hasResultSet: !!props.tab.result?.hasResultSet && props.tab.outputKind !== 'plan',
      hasExecMessage:
        !!props.tab.result &&
        (!props.tab.result.hasResultSet || props.tab.outputKind === 'result'),
      current: props.activePanel,
      event,
    })
    if (next !== props.activePanel) emit('update:activePanel', next)
  },
)
</script>

<template>
  <div class="query-output">
    <div
      :id="panelIds.tablist"
      class="output-tabs"
      role="tablist"
      aria-label="query output"
      @keydown="onTablistKeydown"
    >
      <button
        :id="panelIds.tabs.result"
        type="button"
        class="output-tab"
        :class="{ active: activePanel === 'result' }"
        role="tab"
        :aria-selected="activePanel === 'result'"
        :aria-controls="panelIds.panels.result"
        :tabindex="activePanel === 'result' ? 0 : -1"
        @click="setPanel('result')"
      >
        {{ t('database.query.panelResult') }}
        <span v-if="truncated && !isPlan" class="badge trunc">{{ t('database.query.truncatedBadge') }}</span>
      </button>
      <button
        :id="panelIds.tabs.messages"
        type="button"
        class="output-tab"
        :class="{ active: activePanel === 'messages' }"
        role="tab"
        :aria-selected="activePanel === 'messages'"
        :aria-controls="panelIds.panels.messages"
        :tabindex="activePanel === 'messages' ? 0 : -1"
        @click="setPanel('messages')"
      >
        {{ t('database.query.panelMessages') }}
        <span v-if="tab.error" class="badge err-dot" aria-hidden="true" />
      </button>
      <button
        :id="panelIds.tabs.plan"
        type="button"
        class="output-tab"
        :class="{ active: activePanel === 'plan' }"
        role="tab"
        :aria-selected="activePanel === 'plan'"
        :aria-controls="panelIds.panels.plan"
        :tabindex="activePanel === 'plan' ? 0 : -1"
        @click="setPanel('plan')"
      >
        {{ t('database.query.panelPlan') }}
        <span v-if="truncated && isPlan" class="badge trunc">{{ t('database.query.truncatedBadge') }}</span>
      </button>
      <button
        :id="panelIds.tabs.history"
        type="button"
        class="output-tab"
        :class="{ active: activePanel === 'history' }"
        role="tab"
        :aria-selected="activePanel === 'history'"
        :aria-controls="panelIds.panels.history"
        :tabindex="activePanel === 'history' ? 0 : -1"
        @click="setPanel('history')"
      >
        {{ t('database.query.panelHistory') }}
      </button>
    </div>

    <!-- Result panel -->
    <div
      v-show="activePanel === 'result'"
      :id="panelIds.panels.result"
      class="output-body"
      role="tabpanel"
      :aria-labelledby="panelIds.tabs.result"
    >
      <div class="result-toolbar">
        <span v-if="showResultGrid">
          {{ t('database.query.resultRows', { rows: tab.result!.rowCount }) }}
          <span v-if="truncated" class="badge trunc inline">{{ t('database.query.truncatedBadge') }}</span>
          <template v-if="tab.filter.trim()">
            · {{ t('database.query.filteredRows', { rows: queryDisplayRows.length }) }}
          </template>
          · {{ tab.result!.durationMs }}ms
        </span>
        <span v-else class="dim">{{ t('database.query.resultEmpty') }}</span>
        <div v-if="showResultGrid" class="result-actions">
          <input
            v-model="tab.filter"
            class="ui-input ui-input-sm grid-filter-input"
            type="search"
            :placeholder="t('database.query.filterPlaceholder')"
            :title="t('database.query.localFilterTitle')"
            :aria-label="t('database.query.localFilter')"
          />
          <button type="button" class="ui-btn ui-btn-xs" :title="t('database.query.copyTitle')" @click="emit('copyResult')">
            {{ t('database.query.copy') }}
          </button>
          <button type="button" class="ui-btn ui-btn-xs" :title="t('database.query.exportCsvTitle')" @click="emit('exportCsv')">
            CSV
          </button>
          <button type="button" class="ui-btn ui-btn-xs" :title="t('database.query.exportJsonTitle')" @click="emit('exportJson')">
            JSON
          </button>
        </div>
      </div>
      <DbResultGrid
        v-if="showResultGrid"
        :columns="tab.result!.columns"
        :rows="queryDisplayRows"
        :sort="tab.sort"
        :filter-active="!!tab.filter.trim()"
        @sort="emit('sort', $event)"
        @copy-cell="emit('copyCell', $event)"
      />
      <div v-else class="output-empty-container">
        <AppIcon name="database" size="hero" class="empty-icon" />
        <span class="empty-title">{{ t('database.query.resultEmpty') }}</span>
        <div class="empty-tips">
          <div class="tip-item">
            <span class="tip-label">执行选区/语句:</span>
            <kbd class="tip-key">Ctrl + Enter</kbd>
          </div>
          <div class="tip-item">
            <span class="tip-label">快速收藏脚本:</span>
            <kbd class="tip-key">Ctrl + S</kbd>
          </div>
        </div>
      </div>
    </div>

    <!-- Messages panel -->
    <div
      v-show="activePanel === 'messages'"
      :id="panelIds.panels.messages"
      class="output-body"
      role="tabpanel"
      :aria-labelledby="panelIds.tabs.messages"
      aria-live="polite"
    >
      <div v-if="tab.error" class="err-panel">
        <div class="err-summary">{{ tab.error }}</div>
        <details v-if="tab.errorDetail" class="err-detail">
          <summary>{{ t('database.query.errorDetail') }}</summary>
          <pre>{{ tab.errorDetail }}</pre>
        </details>
        <button
          v-if="tab.errorRetryable"
          type="button"
          class="ui-btn ui-btn-sm"
          style="margin-top: 8px"
          @click="emit('retry')"
        >
          {{ t('database.query.retry') }}
        </button>
      </div>
      <div
        v-else-if="tab.result && !tab.result.hasResultSet && !isPlan"
        class="ok-panel"
      >
        {{ t('database.query.successAffected', { rows: tab.result.affectedRows ?? 0, ms: tab.result.durationMs }) }}
        <template v-if="tab.result.insertId"> · insertId {{ tab.result.insertId }}</template>
      </div>
      <div
        v-else-if="tab.result && tab.result.hasResultSet && !isPlan"
        class="ok-panel"
      >
        {{ t('database.query.resultRows', { rows: tab.result.rowCount }) }}
        · {{ tab.result.durationMs }}ms
        <template v-if="truncated"> · {{ t('database.query.truncatedBadge') }}</template>
      </div>
      <div v-else class="grid-empty dim">{{ t('database.query.messagesEmpty') }}</div>
    </div>

    <!-- Plan panel -->
    <div
      v-show="activePanel === 'plan'"
      :id="panelIds.panels.plan"
      class="output-body"
      role="tabpanel"
      :aria-labelledby="panelIds.tabs.plan"
    >
      <div class="result-toolbar">
        <span class="plan-label">{{ t('database.query.planLabel') }}</span>
        <span v-if="showPlanGrid">
          · {{ tab.result!.rowCount }} rows · {{ tab.result!.durationMs }}ms
          <span v-if="truncated" class="badge trunc inline">{{ t('database.query.truncatedBadge') }}</span>
        </span>
        <span v-else class="dim">{{ t('database.query.planEmpty') }}</span>
        <div v-if="showPlanGrid" class="result-actions">
          <button type="button" class="ui-btn ui-btn-xs" :title="t('database.query.copyTitle')" @click="emit('copyResult')">
            {{ t('database.query.copy') }}
          </button>
          <button type="button" class="ui-btn ui-btn-xs" @click="emit('exportCsv')">CSV</button>
          <button type="button" class="ui-btn ui-btn-xs" @click="emit('exportJson')">JSON</button>
        </div>
      </div>
      <DbResultGrid
        v-if="showPlanGrid"
        :columns="tab.result!.columns"
        :rows="planDisplayRows"
        :sort="tab.sort"
        @sort="emit('sort', $event)"
        @copy-cell="emit('copyCell', $event)"
      />
      <div v-else class="grid-empty dim">{{ t('database.query.planEmpty') }}</div>
    </div>

    <!-- Query history panel -->
    <div
      v-show="activePanel === 'history'"
      :id="panelIds.panels.history"
      class="output-body"
      role="tabpanel"
      :aria-labelledby="panelIds.tabs.history"
    >
      <DbQueryHistoryPanel
        :history="history"
        :history-only-current="historyOnlyCurrent"
        :history-status-filter="historyStatusFilter"
        :connection-name-of="connectionNameOf"
        @update:history-only-current="emit('update:historyOnlyCurrent', $event)"
        @update:history-status-filter="emit('update:historyStatusFilter', $event)"
        @clear-history="emit('clearHistory')"
        @apply-history="emit('applyHistory', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.query-output {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.output-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.output-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.output-tab:hover {
  color: var(--text-primary);
}

.output-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  line-height: 1.4;
}

.badge.trunc {
  background: color-mix(in srgb, var(--warning, #d29922) 18%, transparent);
  color: var(--warning, #d29922);
}

.badge.trunc.inline {
  margin-left: 4px;
}

.badge.err-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border-radius: 50%;
  background: var(--danger, #f85149);
}

.output-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.result-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  flex-wrap: nowrap;
  min-width: 0;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.result-actions :deep(.ui-btn-xs) {
  flex-shrink: 0;
}

.result-toolbar :deep(.grid-filter-input.ui-input-sm) {
  box-sizing: border-box;
  height: 26px;
  min-height: 26px;
  max-height: 26px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 24px;
}

.grid-filter-input {
  width: 160px;
  min-width: 72px;
  flex: 1 1 72px;
}

@container db-query (max-width: 720px) {
  .grid-filter-input {
    width: 100px;
    min-width: 56px;
  }
}

@container db-query (max-width: 520px) {
  .grid-filter-input {
    width: 72px;
    min-width: 48px;
  }
}

.plan-label {
  font-weight: 700;
  color: var(--accent);
}

.dim,
.grid-empty.dim {
  color: var(--text-secondary);
  opacity: 0.8;
}

.grid-empty,
.ok-panel {
  padding: 24px;
  color: var(--text-secondary);
  font-size: 12px;
}

.err-panel {
  margin: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border-color));
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: var(--db-font-size, 13px);
  white-space: pre-wrap;
  font-family: var(--db-font-family, var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace));
}

.err-summary {
  font-weight: 600;
}

.err-detail {
  margin-top: 6px;
  font-size: var(--db-font-size, 13px);
}

.err-detail pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}

.output-empty-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.empty-icon {
  color: var(--text-secondary);
  opacity: 0.45;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 20px;
  opacity: 0.8;
}

.empty-tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
  max-width: 320px;
  width: 100%;
}

.tip-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.tip-label {
  opacity: 0.75;
}

.tip-key {
  font-family: var(--font-mono, monospace);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  box-shadow: 0 1px 0 rgba(0,0,0,0.1);
  color: var(--text-primary);
}

.tip-link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  text-decoration: underline;
}

.tip-link-btn:hover {
  color: var(--accent-hover, var(--accent));
}

</style>
