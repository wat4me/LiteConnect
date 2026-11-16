<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
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
import ToolbarDropdown from '../common/ToolbarDropdown.vue'

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

const exportItems = computed(() => [
  { id: 'csv', label: t('database.query.exportCsvTitle') },
  { id: 'json', label: t('database.query.exportJsonTitle') },
])
function exportResult(format: string) {
  if (format === 'csv') emit('exportCsv')
  else if (format === 'json') emit('exportJson')
}

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
const previousOutput = computed(() => !!props.tab.result && (props.tab.loading || !!props.tab.error))
const resultEmptyLabel = computed(() => {
  if (props.tab.loading) return t('database.query.running')
  if (props.tab.error) return t('database.msg.execFailed')
  if (isPlan.value) return t('database.query.resultIsPlan')
  if (props.tab.result) return t('database.query.noResultSet')
  return t('database.query.resultEmpty')
})
const displayedRowCount = computed(() => {
  const rows = props.tab.result?.rowCount ?? 0
  return t(truncated.value ? 'database.query.truncatedRows' : 'database.query.resultRows', { rows })
})
const panelIds = computed(() => outputPanelDomIds(props.tab.id))

async function copyError() {
  const { error, errorCode, errorDetail } = props.tab
  const text = [errorCode ? `${error} [${errorCode}]` : error, errorDetail].filter(Boolean).join('\n')
  try {
    await window.LiteConnect.clipboardWriteText(text)
    ElMessage.success(t('database.msg.copied'))
  } catch {
    ElMessage.error(t('database.msg.copyFailed'))
  }
}

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
      props.tab.id,
      props.tab.error,
      props.tab.result,
      props.tab.outputKind,
      props.tab.loading,
    ] as const,
  (
    curr,
    prev,
  ) => {
    if (props.tab.loading) return
    const wasLoading = prev?.[4] ?? false
    // Only auto-switch when a run just finished or error/result identity changed after load
    if (!wasLoading && prev && curr.slice(0, 4).every((value, index) => value === prev[index])) {
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
  { immediate: true },
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
      <div v-if="showResultGrid" class="result-toolbar">
        <span role="status">
          <span v-if="previousOutput" class="badge trunc inline">{{ t('database.query.previousResult') }}</span>
          {{ displayedRowCount }}
          <template v-if="tab.result!.rows.length && tab.filter.trim()">
            · {{ t('database.query.filteredRows', { rows: queryDisplayRows.length }) }}
          </template>
          · {{ tab.result!.durationMs }}ms
        </span>
        <div class="result-actions">
          <div v-if="tab.result!.rows.length" class="grid-filter-field">
            <input
              v-model="tab.filter"
              class="ui-input ui-input-sm grid-filter-input"
              type="text"
              :placeholder="t('database.query.filterPlaceholder')"
              :title="t('database.query.localFilterTitle')"
              :aria-label="t('database.query.localFilter')"
            />
            <button
              v-if="tab.filter"
              type="button"
              class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost ui-icon-btn-close grid-filter-clear"
              :title="t('common.clear')"
              :aria-label="t('common.clear')"
              @click="tab.filter = ''"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('database.query.copyTitle')" :aria-label="t('database.query.copyTitle')" @click="emit('copyResult')">
            <AppIcon name="copy" size="sm" />
          </button>
          <ToolbarDropdown :label="t('database.query.exportResults')" :items="exportItems" icon-only trigger-icon="download" show-chevron teleport align="right" @select="exportResult" />
        </div>
      </div>
      <DbResultGrid
        v-if="showResultGrid"
        :columns="tab.result!.columns"
        :rows="queryDisplayRows"
        :sort="tab.sort"
        :filter-active="!!tab.result!.rows.length && !!tab.filter.trim()"
        :empty-text="t('database.query.zeroRows')"
        @sort="emit('sort', $event)"
        @copy-cell="emit('copyCell', $event)"
      />
      <div v-else-if="!tab.loading && !tab.error && !tab.result" class="ui-empty output-idle">
        <div class="ui-empty-icon" aria-hidden="true">
          <AppIcon name="database" size="hero" />
        </div>
        <span class="ui-empty-title">{{ resultEmptyLabel }}</span>
        <div class="empty-tips">
          <div class="tip-item">
            <span>{{ t('database.query.runSelectionTip') }}</span>
            <kbd>Ctrl + Enter</kbd>
          </div>
          <div class="tip-item">
            <span>{{ t('database.query.saveScriptTip') }}</span>
            <kbd>Ctrl + S</kbd>
          </div>
        </div>
      </div>
      <div v-else class="output-empty">
        <span role="status">{{ resultEmptyLabel }}</span>
        <button
          v-if="!tab.loading && (tab.error || tab.result)"
          type="button"
          class="ui-btn ui-btn-sm"
          @click="setPanel(tab.error || !isPlan ? 'messages' : 'plan')"
        >
          {{ t(tab.error || !isPlan ? 'database.query.viewMessages' : 'database.query.viewPlan') }}
        </button>
      </div>
    </div>

    <!-- Messages panel -->
    <div
      v-show="activePanel === 'messages'"
      :id="panelIds.panels.messages"
      class="output-body messages-body"
      role="tabpanel"
      :aria-labelledby="panelIds.tabs.messages"
      aria-live="polite"
    >
      <div v-if="tab.loading" class="grid-empty">{{ t('database.query.running') }}</div>
      <div v-else-if="tab.error" class="err-panel">
        <div class="err-header">
          <AppIcon name="alert-circle" size="sm" class="err-icon" />
          <strong class="err-summary">{{ tab.error }}</strong>
          <code v-if="tab.errorCode" class="err-code">{{ tab.errorCode }}</code>
          <div class="err-actions">
            <button v-if="tab.errorRetryable" type="button" class="ui-btn ui-btn-sm" @click="emit('retry')">
              {{ t('database.query.retry') }}
            </button>
            <button type="button" class="ui-btn ui-btn-sm" @click="copyError">
              <AppIcon name="copy" size="xs" />
              {{ t('database.query.copyError') }}
            </button>
          </div>
        </div>
        <pre v-if="tab.errorDetail" class="err-detail" tabindex="0" :aria-label="t('database.query.errorDetail')">{{ tab.errorDetail }}</pre>
      </div>
      <div
        v-else-if="tab.result && !tab.result.hasResultSet && !isPlan"
        class="ok-panel"
      >
        <template v-if="(tab.result.batch?.statementCount ?? 0) > 1">
          {{ t('database.query.successBatch', {
            count: tab.result.batch!.statementCount,
            rows: tab.result.affectedRows ?? 0,
            ms: tab.result.durationMs,
          }) }}
        </template>
        <template v-else>
          {{ t('database.query.successAffected', { rows: tab.result.affectedRows ?? 0, ms: tab.result.durationMs }) }}
        </template>
        <template v-if="tab.result.insertId"> · insertId {{ tab.result.insertId }}</template>
      </div>
      <div
        v-else-if="tab.result && tab.result.hasResultSet && !isPlan"
        class="ok-panel"
      >
        <template v-if="(tab.result.batch?.statementCount ?? 0) > 1">
          {{ t('database.query.successBatchResult', {
            count: tab.result.batch!.statementCount,
            rows: tab.result.rowCount,
            ms: tab.result.durationMs,
          }) }}
        </template>
        <template v-else>
          {{ t('database.query.resultRows', { rows: tab.result.rowCount }) }}
          · {{ tab.result.durationMs }}ms
        </template>
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
      <div v-if="showPlanGrid" class="result-toolbar">
        <span class="plan-label">{{ t('database.query.planLabel') }}</span>
        <span>
          <span v-if="previousOutput" class="badge trunc inline">{{ t('database.query.previousPlan') }}</span>
          {{ displayedRowCount }} · {{ tab.result!.durationMs }}ms
        </span>
        <div class="result-actions">
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('database.query.copyTitle')" :aria-label="t('database.query.copyTitle')" @click="emit('copyResult')">
            <AppIcon name="copy" size="sm" />
          </button>
          <ToolbarDropdown :label="t('database.query.exportResults')" :items="exportItems" icon-only trigger-icon="download" show-chevron teleport align="right" @select="exportResult" />
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
  overflow-x: auto;
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
  white-space: nowrap;
  flex-shrink: 0;
}

.output-tab:hover {
  color: var(--text-primary);
}

.output-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--text-primary);
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
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
}

.badge.trunc.inline {
  margin-left: 4px;
}

.badge.err-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border-radius: 50%;
  background: var(--danger);
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
  flex-wrap: wrap;
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

.grid-filter-input.ui-input-sm {
  box-sizing: border-box;
  height: 26px;
  min-height: 26px;
  max-height: 26px;
  padding: 0 28px 0 8px;
  font-size: 11px;
  line-height: 24px;
}

.grid-filter-field {
  position: relative;
  width: 160px;
  min-width: 72px;
  flex: 1 1 72px;
}

.grid-filter-input {
  width: 100%;
}

.grid-filter-clear {
  position: absolute;
  top: 50%;
  right: 3px;
  transform: translateY(-50%);
  width: 20px !important;
  height: 20px !important;
}

@container db-query (max-width: 720px) {
  .grid-filter-field {
    width: 100px;
    min-width: 56px;
  }
}

@container db-query (max-width: 520px) {
  .grid-filter-field {
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
  flex: none;
  margin: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border-color));
  background: color-mix(in srgb, var(--danger) 5%, var(--bg-primary));
  color: var(--text-primary);
}

.messages-body {
  overflow-y: auto;
}

.err-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.err-icon {
  flex-shrink: 0;
  color: var(--danger);
}

.err-summary {
  overflow-wrap: anywhere;
}

.err-code {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--text-secondary);
}

.err-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-inline-start: auto;
}

.err-detail {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--bg-secondary);
  font: var(--db-font-size, 13px)/1.5 var(--db-font-family, var(--font-mono, monospace));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
}

.output-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 0;
  padding: 24px 12px;
  color: var(--text-secondary);
  text-align: center;
}

.output-idle {
  flex: 1;
  justify-content: safe center;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}

.output-idle .ui-empty-icon {
  flex-shrink: 0;
}

.empty-tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-width: 320px;
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg-secondary);
  font-size: 12px;
}

.tip-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: start;
}

.tip-item kbd {
  padding: 2px 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: 11px var(--font-mono);
  white-space: nowrap;
}
</style>
