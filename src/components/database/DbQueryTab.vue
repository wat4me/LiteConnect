<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SqlDialect } from '@/utils/database/dbSql'
import type { DbColumnInfo, DbTableInfo } from '../../env.d'
import type { QueryHistoryItem, QueryTab, SavedQuery } from '@/domain/database/types'
import {
  canRunCurrentStatement,
  defaultRunScope,
  resolveRunSql,
  type RunScope,
} from '@/utils/database/sqlStatement'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { QueryOutputPanel } from '@/utils/database/queryOutputPanel'
import {
  editorStatusFromSelection,
  resolvePreferredRunScope,
  sanitizeQueryTabExecOptions,
  type QueryTabExecOptions,
} from '@/utils/database/queryTabOptions'
import DbQueryContextBar from './DbQueryContextBar.vue'
import DbQueryActionRail from './DbQueryActionRail.vue'
import DbSqlEditor from './DbSqlEditor.vue'
import DbQueryOutput from './DbQueryOutput.vue'
import DbQuerySettingsPopover from './DbQuerySettingsPopover.vue'
import AppIcon from '../icons/AppIcon.vue'
import { createTxDurationTimer, formatTxDuration } from '@/utils/database/txDurationTimer'

const { t } = useI18n()

type HistoryStatusFilter = 'all' | 'success' | 'failed' | 'cancelled' | 'slow'

const props = defineProps<{
  tab: QueryTab
  connectionName: string
  connectionNameOf: (connectionId: string) => string
  connectionMeta: string
  databases: string[]
  savedQueries: SavedQuery[]
  history: QueryHistoryItem[]
  historyOnlyCurrent: boolean
  historyStatusFilter: HistoryStatusFilter
  sessionAlive: boolean
  dialect: SqlDialect
  getTables: (database: string) => DbTableInfo[]
  ensureTables: (database: string) => Promise<void>
  ensureColumns: (database: string, table: string) => Promise<DbColumnInfo[]>
}>()

const emit = defineEmits<{
  /** sql + explicit run scope (selection | statement | all) for dirty tracking */
  run: [sql: string, scope: RunScope]
  explain: [sql: string]
  cancel: []
  beginTx: []
  commitTx: []
  rollbackTx: []
  changeDatabase: [database: string]

  copyResult: []
  exportCsv: []
  exportJson: []
  copyCell: [value: unknown]
  retry: []
  sqlChanged: []
  'update:readOnly': [value: boolean]
  'update:execOptions': [opts: QueryTabExecOptions]
  saveQuery: [tabId: string, sql: string, connectionId: string, database: string]
  deleteSavedQuery: [id: string]
  renameSavedQuery: [id: string, newTitle: string]
  applySavedQuery: [item: SavedQuery]
  'update:historyOnlyCurrent': [value: boolean]
  'update:historyStatusFilter': [value: HistoryStatusFilter]
  clearHistory: []
  applyHistory: [item: QueryHistoryItem]
}>()

const querySplitRatio = ref(0.38)
const activeOutputPanel = ref<QueryOutputPanel>('result')
const sqlEditorRef = ref<InstanceType<typeof DbSqlEditor> | null>(null)
const contextBarRef = ref<InstanceType<typeof DbQueryContextBar> | null>(null)
const settingsRef = ref<InstanceType<typeof DbQuerySettingsPopover> | null>(null)
/** Bumped on selection-related events so default run scope recomputes */
const selectionTick = ref(0)
/** Cursor/selection snapshot derived from live editor (not a second document). */
const editorStatus = ref({ line: 1, column: 1, selectionChars: 0 })

const hasSelection = computed(() => {
  void selectionTick.value
  void props.tab.sql
  return sqlEditorRef.value?.hasNonEmptySelection() ?? false
})

const canRunStatement = computed(() => {
  void selectionTick.value
  void props.tab.sql
  void props.dialect
  const sel = sqlEditorRef.value?.getSelection() ?? { start: 0, end: 0 }
  const cursor = hasSelection.value ? sel.start : sel.end
  return canRunCurrentStatement(props.tab.sql, cursor, props.dialect)
})

const defaultScope = computed((): RunScope => {
  const pref = props.tab.defaultRunScope ?? 'smart'
  return resolvePreferredRunScope({
    pref,
    hasSelection: hasSelection.value,
    canRunStatement: canRunStatement.value,
    smart: defaultRunScope,
  })
})

const execOpts = computed(() =>
  sanitizeQueryTabExecOptions({
    maxRows: props.tab.maxRows,
    timeoutMs: props.tab.timeoutMs,
    defaultRunScope: props.tab.defaultRunScope,
  }),
)

const dialectLabel = computed(() =>
  props.dialect === 'postgres'
    ? 'PostgreSQL'
    : props.dialect === 'oracle'
      ? 'Oracle'
      : 'MySQL',
)

const scopeIndicator = computed(() => {
  if (defaultScope.value === 'selection') return t('database.query.scopeIndicatorSelection')
  if (defaultScope.value === 'statement') return t('database.query.scopeIndicatorStatement')
  return t('database.query.scopeIndicatorAll')
})

const lastExecSummary = computed(() => {
  const result = props.tab.result
  if (!result) return ''
  const { durationMs: ms, hasResultSet, rowCount, affectedRows } = result
  return hasResultSet
    ? t('database.query.lastExecResult', { ms, rows: rowCount })
    : t('database.query.lastExecAffected', { ms, rows: affectedRows ?? 0 })
})

const elapsed = ref('0:00')
const executionTimer = createTxDurationTimer({
  onTick: (ms) => { elapsed.value = formatTxDuration(ms) },
})
watch(() => props.tab.running, (running) => {
  if (running) executionTimer.start(running.startedAt)
  else executionTimer.stop()
}, { immediate: true })
onBeforeUnmount(() => executionTimer.stop())

const runningLabel = computed(() => {
  if (props.tab.cancelling) return t('database.query.cancelling')
  switch (props.tab.running?.scope) {
    case 'selection': return t('database.query.runningSelection')
    case 'statement': return t('database.query.runningStatement')
    case 'all': return t('database.query.runningAll')
    case 'explain': return t('database.query.runningExplain')
    default: return t('database.query.running')
  }
})

const bottomStyle = computed(() => {
  return { flex: 1 - querySplitRatio.value }
})

const topStyle = computed(() => {
  return { flex: querySplitRatio.value }
})

function bumpSelection() {
  selectionTick.value += 1
  refreshEditorStatus()
}

function refreshEditorStatus() {
  const sel = sqlEditorRef.value?.getSelection() ?? { start: 0, end: 0 }
  const head = sel.end
  editorStatus.value = editorStatusFromSelection({
    doc: props.tab.sql ?? '',
    head,
    selectionStart: sel.start,
    selectionEnd: sel.end,
  })
}

function resolveSql(scope?: RunScope) {
  const sel = sqlEditorRef.value?.getSelection() ?? { start: 0, end: 0 }
  return resolveRunSql({
    sql: props.tab.sql,
    selectionStart: sel.start,
    selectionEnd: sel.end,
    scope,
    dialect: props.dialect,
  })
}

function getSqlToRun(scope?: RunScope): string {
  return resolveSql(scope).sql
}

function onRun(scope: RunScope) {
  closePopovers()
  const resolved = resolveSql(scope)
  if (!resolved.sql) {
    if (resolved.reason === 'no-selection') {
      ElMessage.warning(t('database.query.noSelectionToast'))
    } else if (resolved.reason === 'ambiguous' || resolved.reason === 'no-statement') {
      ElMessage.warning(t('database.query.statementAmbiguousToast'))
    }
    return
  }
  // Pass explicit requested scope (not resolved fallback) for dirty rules
  emit('run', resolved.sql, scope)
}

function onRunDefault() {
  onRun(defaultScope.value)
}

function onExplain() {
  closePopovers()
  const resolved = resolveSql(defaultScope.value)
  if (!resolved.sql) {
    if (resolved.reason === 'no-selection') {
      ElMessage.warning(t('database.query.noSelectionToast'))
    } else if (resolved.reason === 'ambiguous' || resolved.reason === 'no-statement') {
      ElMessage.warning(t('database.query.statementAmbiguousToast'))
    }
    return
  }
  emit('explain', resolved.sql)
}

function onCancel() {
  emit('cancel')
}

function toggleQuerySort(col: string) {
  const tab = props.tab
  if (!tab.sort || tab.sort.col !== col) {
    tab.sort = { col, dir: 'asc' }
  } else if (tab.sort.dir === 'asc') {
    tab.sort = { col, dir: 'desc' }
  } else {
    tab.sort = null
  }
}

function onExecOptions(opts: QueryTabExecOptions) {
  emit('update:execOptions', sanitizeQueryTabExecOptions(opts))
}

/** Active split-drag document listeners; cleared on mouseup or unmount */
let splitDragCleanup: (() => void) | null = null

function stopSplitDrag() {
  if (!splitDragCleanup) return
  splitDragCleanup()
  splitDragCleanup = null
}

function startSplitDrag(e: MouseEvent) {
  e.preventDefault()
  stopSplitDrag()
  const startY = e.clientY
  const startRatio = querySplitRatio.value
  const barEl = e.target as HTMLElement
  const onMove = (ev: MouseEvent) => {
    const parent = barEl.parentElement
    if (!parent) return
    const h = parent.clientHeight || 1
    const delta = (ev.clientY - startY) / h
    querySplitRatio.value = Math.min(0.75, Math.max(0.18, startRatio + delta))
  }
  const onUp = () => {
    stopSplitDrag()
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  splitDragCleanup = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
}

function closePopovers() {
  contextBarRef.value?.closePopovers()
  settingsRef.value?.close()
}

function focusEditorIfRequested() {
  if (!props.tab.focusEditor) return
  void nextTick(() => {
    sqlEditorRef.value?.focus()
    props.tab.focusEditor = false
  })
}

onMounted(() => {
  focusEditorIfRequested()
  refreshEditorStatus()
})

onBeforeUnmount(() => {
  stopSplitDrag()
})

watch(
  () => props.tab.focusEditor,
  (v) => {
    if (v) focusEditorIfRequested()
  },
)

watch(
  () => props.tab.sql,
  () => {
    emit('sqlChanged')
    refreshEditorStatus()
  },
)

function onSaveQuery() {
  emit('saveQuery', props.tab.id, props.tab.sql, props.tab.connectionId, props.tab.database)
}

defineExpose({ closePopovers, getSqlToRun })
</script>

<template>
  <div class="query-split" @mouseup="bumpSelection" @keyup="bumpSelection">
    <div class="query-top" :style="topStyle">
      <DbQueryContextBar
        ref="contextBarRef"
        :connection-name="connectionName"
        :connection-meta="connectionMeta"
        :database="tab.database"
        :databases="databases"
        :session-alive="sessionAlive"
        :loading="tab.loading"
        :in-transaction="!!tab.inTransaction"
        :transaction-started-at="tab.transactionStartedAt"
        :read-only="!!tab.readOnly"
        :saved-queries="savedQueries"
        @change-database="emit('changeDatabase', $event)"
        @begin-tx="emit('beginTx')"
        @commit-tx="emit('commitTx')"
        @rollback-tx="emit('rollbackTx')"
        @update:read-only="emit('update:readOnly', $event)"
        @delete-saved-query="emit('deleteSavedQuery', $event)"
        @rename-saved-query="emit('renameSavedQuery', $event[0], $event[1])"
        @apply-saved-query="emit('applySavedQuery', $event)"
      />
      <div class="query-editor-row">
        <DbQueryActionRail
          :loading="tab.loading"
          :can-cancel="!!tab.queryId"
          :cancelling="!!tab.cancelling"
          :session-alive="sessionAlive"
          :default-scope="defaultScope"
          :has-selection="hasSelection"
          :can-run-statement="canRunStatement"
          :has-sql="!!tab.sql.trim()"
          :read-only="!!tab.readOnly"
          :is-saved="!!tab.savedQueryId"
          @run="onRun"
          @cancel="onCancel"
          @explain="onExplain"
          @save-query="onSaveQuery"
        />
        <div class="editor-main">
          <DbSqlEditor
            ref="sqlEditorRef"
            :tab="tab"
            :session-alive="sessionAlive"
            :dialect="dialect"
            :get-tables="getTables"
            :ensure-tables="ensureTables"
            :ensure-columns="ensureColumns"
            @run-default="onRunDefault"
            @cancel="onCancel"
            @selection-change="bumpSelection"
            @save-query="onSaveQuery"
          />
          <div class="query-status-bar" role="status">
            <span class="st-item mono">
              {{
                t('database.query.statusCursor', {
                  line: editorStatus.line,
                  column: editorStatus.column,
                })
              }}
            </span>
            <span v-if="editorStatus.selectionChars > 0" class="st-item">
              {{ t('database.query.statusSelection', { n: editorStatus.selectionChars }) }}
            </span>
            <span class="st-item st-scope" :title="t('database.query.scopeIndicatorHint')">
              <AppIcon name="play" size="xs" /> {{ scopeIndicator }}
            </span>
            <span class="st-item">{{ dialectLabel }}</span>
            <span v-if="tab.loading" class="st-item st-running">
              {{ runningLabel }}
              <span v-if="tab.running" aria-hidden="true"> · {{ elapsed }}</span>
            </span>
            <span v-else-if="lastExecSummary" class="st-item st-last-exec" :title="t('database.query.lastExecTitle')">
              {{ lastExecSummary }}
            </span>
            <div class="st-actions">
              <button
                type="button"
                class="ui-btn ui-btn-ghost ui-btn-xs st-btn"
                :title="t('database.query.logTitle')"
                @click="activeOutputPanel = 'history'"
              >
                {{ t('database.query.log') }}
              </button>
              <DbQuerySettingsPopover
                ref="settingsRef"
                :max-rows="execOpts.maxRows"
                :timeout-ms="execOpts.timeoutMs"
                :default-run-scope="execOpts.defaultRunScope"
                @apply="onExecOptions"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      class="query-split-bar"
      @mousedown="startSplitDrag"
    />
    <div
      class="query-bottom"
      :style="bottomStyle"
    >
      <DbQueryOutput
        :tab="tab"
        :active-panel="activeOutputPanel"
        :history="history"
        :history-only-current="historyOnlyCurrent"
        :history-status-filter="historyStatusFilter"
        :connection-name-of="connectionNameOf"
        @update:active-panel="activeOutputPanel = $event"
        @copy-result="emit('copyResult')"
        @export-csv="emit('exportCsv')"
        @export-json="emit('exportJson')"
        @copy-cell="emit('copyCell', $event)"
        @retry="emit('retry')"
        @sort="toggleQuerySort"
        @update:history-only-current="emit('update:historyOnlyCurrent', $event)"
        @update:history-status-filter="emit('update:historyStatusFilter', $event)"
        @clear-history="emit('clearHistory')"
        @apply-history="emit('applyHistory', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.query-split {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
  container-name: db-query;
}

.query-top {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border-color);
  overflow: visible;
  min-width: 0;
}

.query-editor-row {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.editor-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.query-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 26px;
  padding: 2px 8px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.st-item {
  white-space: nowrap;
}

.st-item.mono {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.st-scope {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--accent);
  font-weight: 600;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
}

.st-last-exec {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.st-running {
  color: var(--accent);
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.st-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.query-split-bar {
  height: 6px;
  cursor: row-resize;
  background: var(--border-color);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.query-split-bar::after {
  content: "";
  width: 24px;
  height: 3px;
  border-radius: 1.5px;
  background: var(--text-secondary);
  opacity: 0.35;
  transition: opacity 0.15s, background-color 0.15s;
}

.query-split-bar:hover {
  background: var(--accent);
}

.query-split-bar:hover::after {
  background: var(--bg-primary);
  opacity: 0.8;
}

.query-bottom {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}
</style>
