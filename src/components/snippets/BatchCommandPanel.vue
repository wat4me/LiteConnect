<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useBatchCommand, type BatchCommandTarget } from '@/composables/snippets/useBatchCommand'
import type { CommandSnippet } from '@/env.d'
import { resolveSnippetCommand } from '@/utils/snippets/commandSnippets'
import { addAppEventListener } from '@/utils/shared/appEvents'

const { t } = useI18n()

const props = defineProps<{
  sessions: BatchCommandTarget[]
  /** Prefill from command snippets panel */
  initialCommand?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'clear-initial'): void
  (e: 'save-as-snippet', command: string): void
}>()

const {
  results,
  isRunning,
  hasResults,
  successCount,
  errorCount,
  cancelledCount,
  pendingCount,
  recentHistory,
  expandForSessions,
  executeBatch,
  cancelBatch,
  clearResults,
  exportResults,
} = useBatchCommand()

const commandInput = ref(props.initialCommand || '')
const selectedSessions = ref<Set<string>>(new Set(props.sessions.map(s => s.id)))
const timeoutInput = ref(30)
const snippets = ref<CommandSnippet[]>([])
const snippetSelect = ref('')
const showPreview = ref(false)
const showHistory = ref(false)

const canExecute = computed(() =>
  commandInput.value.trim().length > 0 &&
  selectedSessions.value.size > 0 &&
  !isRunning.value
)

const selectedList = computed(() =>
  props.sessions.filter((s) => selectedSessions.value.has(s.id)),
)

const previewRows = computed(() => {
  if (!commandInput.value.trim() || selectedList.value.length === 0) return []
  return expandForSessions(selectedList.value, commandInput.value)
})

const snippetOptions = computed(() => {
  const list = [...snippets.value]
  list.sort((a, b) => {
    const pa = a.pinned === true
    const pb = b.pinned === true
    if (pa !== pb) return pa ? -1 : 1
    const ga = a.group || ''
    const gb = b.group || ''
    if (ga !== gb) return ga.localeCompare(gb)
    return a.name.localeCompare(b.name)
  })
  return list
})

watch(
  () => props.initialCommand,
  (cmd) => {
    if (cmd != null && cmd !== '') {
      commandInput.value = cmd
      emit('clear-initial')
    }
  },
)

watch(
  () => props.sessions.map((s) => s.id).join(','),
  () => {
    const valid = new Set(props.sessions.map((s) => s.id))
    const next = new Set<string>()
    for (const id of selectedSessions.value) {
      if (valid.has(id)) next.add(id)
    }
    if (next.size === 0) {
      selectedSessions.value = new Set(props.sessions.map((s) => s.id))
    } else {
      selectedSessions.value = next
    }
  },
)

async function loadSnippets() {
  try {
    snippets.value = await window.LiteConnect.getCommandSnippets()
  } catch {
    snippets.value = []
  }
}

function onSnippetPick() {
  const id = snippetSelect.value
  if (!id) return
  const item = snippets.value.find((s) => s.id === id)
  if (item) {
    commandInput.value = item.command
  }
  snippetSelect.value = ''
}

function toggleSession(sessionId: string) {
  if (selectedSessions.value.has(sessionId)) {
    selectedSessions.value.delete(sessionId)
  } else {
    selectedSessions.value.add(sessionId)
  }
}

function selectAll() {
  selectedSessions.value = new Set(props.sessions.map(s => s.id))
}

function selectNone() {
  selectedSessions.value = new Set()
}

async function handleExecute() {
  if (!canExecute.value) return
  showPreview.value = false
  await executeBatch(selectedList.value, commandInput.value, timeoutInput.value * 1000)
}

function handleCancel() {
  cancelBatch()
  ElMessage.info(t('batch.cancelRequested'))
}

async function handleCopyResults() {
  const text = exportResults()
  if (!text.trim()) {
    ElMessage.info(t('batch.nothingToExport'))
    return
  }
  try {
    await window.LiteConnect.clipboardWriteText(text)
    ElMessage.success(t('batch.copied'))
  } catch {
    ElMessage.warning(t('batch.copyFailed'))
  }
}

function applyHistory(cmd: string) {
  commandInput.value = cmd
  showHistory.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    if (isRunning.value) return
    handleExecute()
  }
}

function sampleExpanded(cmd: string): string {
  const first = selectedList.value[0]
  if (!first) return cmd
  return resolveSnippetCommand(cmd, {
    host: first.host,
    user: first.user,
    port: first.port,
    name: first.connectionName,
  })
}

let stopSnippetsListener: (() => void) | null = null
onMounted(() => {
  void loadSnippets()
  stopSnippetsListener = addAppEventListener('command-snippets-change', () => {
    void loadSnippets()
  })
})
onBeforeUnmount(() => {
  stopSnippetsListener?.()
})
</script>

<template>
  <div class="batch-panel">
    <div class="batch-header">
      <div class="batch-title">
        <span>{{ t('batch.title') }}</span>
        <span class="batch-title-badge">{{ selectedSessions.size }}/{{ sessions.length }}</span>
      </div>
      <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close batch-close" @click="emit('close')" :title="t('batch.close')">
        <AppIcon name="close" size="sm" />
      </button>
    </div>

    <div class="batch-sessions">
      <div class="sessions-header">
        <span>{{ t('batch.targetSessions', { selected: selectedSessions.size, total: sessions.length }) }}</span>
        <div class="sessions-actions">
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" :disabled="isRunning" @click="selectAll">{{ t('batch.selectAll') }}</button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" :disabled="isRunning" @click="selectNone">{{ t('batch.selectNone') }}</button>
        </div>
      </div>
      <div class="sessions-pills">
        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          class="session-pill"
          :class="{ selected: selectedSessions.has(session.id) }"
          :title="session.sshAddress"
          :disabled="isRunning"
          :aria-pressed="selectedSessions.has(session.id)"
          @click="toggleSession(session.id)"
        >
          <span class="session-pill-dot" aria-hidden="true" />
          <span class="session-pill-name">{{ session.displayName }}</span>
        </button>
      </div>
    </div>

    <div class="batch-input">
      <div class="snippet-row">
        <select
          v-model="snippetSelect"
          class="ui-select ui-input-sm snippet-select"
          :disabled="isRunning || snippetOptions.length === 0"
          @focus="loadSnippets"
          @change="onSnippetPick"
        >
          <option value="">{{ t('batch.fromSnippet') }}</option>
          <option v-for="s in snippetOptions" :key="s.id" :value="s.id">
            {{ s.group ? `[${s.group}] ` : '' }}{{ s.name }}
          </option>
        </select>
        <button
          v-if="recentHistory.length"
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          :class="{ active: showHistory }"
          :title="t('batch.recentCommands')"
          :aria-label="t('batch.recentCommands')"
          :aria-expanded="showHistory"
          @click="showHistory = !showHistory"
        ><AppIcon name="history" size="sm" /></button>
      </div>
      <div v-if="showHistory" class="history-list">
        <button
          v-for="h in recentHistory"
          :key="h.id"
          type="button"
          class="history-item"
          @click="applyHistory(h.command)"
        >
          <span class="history-cmd">{{ h.command }}</span>
          <span class="history-meta">{{ h.success }}/{{ h.total }} · {{ new Date(h.at).toLocaleString() }}</span>
        </button>
      </div>
      <div class="batch-composer">
        <textarea
          v-model="commandInput"
          class="ui-textarea ui-input-sm ui-input-mono command-textarea"
          :placeholder="t('batch.commandPlaceholder')"
          rows="3"
          @keydown="handleKeydown"
          :disabled="isRunning"
        />
        <div class="composer-bar">
          <div class="input-options">
            <label class="timeout-label">
              <span>{{ t('batch.timeoutSec') }}</span>
              <input
                type="number"
                v-model.number="timeoutInput"
                class="ui-input ui-input-sm timeout-input"
                min="5"
                max="300"
                :disabled="isRunning"
              />
            </label>
            <button
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
              :class="{ active: showPreview }"
              :title="t(showPreview ? 'batch.collapsePreview' : 'batch.expandPreview')"
              :aria-label="t(showPreview ? 'batch.collapsePreview' : 'batch.expandPreview')"
              :aria-expanded="showPreview"
              :disabled="!commandInput.trim() || selectedSessions.size === 0"
              @click="showPreview = !showPreview"
            ><AppIcon name="eye" size="sm" /></button>
            <button
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
              :title="t('terminal.saveAsSnippet')"
              :aria-label="t('terminal.saveAsSnippet')"
              :disabled="!commandInput.trim()"
              @click="emit('save-as-snippet', commandInput.trim())"
            ><AppIcon name="file-terminal" size="sm" /></button>
          </div>
          <div class="batch-actions">
            <button v-if="hasResults && !isRunning" type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('batch.copyResults')" :aria-label="t('batch.copyResults')" @click="handleCopyResults"><AppIcon name="copy" size="sm" /></button>
            <button v-if="hasResults" type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('batch.clearResults')" :aria-label="t('batch.clearResults')" :disabled="isRunning" @click="clearResults"><AppIcon name="clear" size="sm" /></button>
            <button
              v-if="!isRunning"
              class="ui-btn ui-btn-sm ui-btn-primary execute-btn"
              :disabled="!canExecute"
              @click="handleExecute"
            >
              <AppIcon name="play" size="sm" />
              <span>{{ t('batch.execute') }}</span>
            </button>
            <button
              v-else
              class="ui-btn ui-btn-sm ui-btn-danger execute-btn"
              type="button"
              @click="handleCancel"
            >
              <AppIcon name="stop" size="sm" />
              <span>{{ t('batch.cancel') }}</span>
            </button>
          </div>
        </div>
      </div>
      <div v-if="showPreview && previewRows.length" class="preview-box">
        <div class="preview-title">{{ t('batch.previewTitle', { count: previewRows.length }) }}</div>
        <div v-for="row in previewRows" :key="row.sessionId" class="preview-row">
          <span class="preview-name">{{ row.displayName }}</span>
          <code class="preview-cmd">{{ row.command }}</code>
        </div>
      </div>
    </div>

    <div v-if="hasResults" class="batch-results">
      <div class="results-summary">
        <span v-if="successCount > 0" class="result-count success">{{ t('batch.countSuccess', { count: successCount }) }}</span>
        <span v-if="errorCount > 0" class="result-count error">{{ t('batch.countError', { count: errorCount }) }}</span>
        <span v-if="cancelledCount > 0" class="result-count cancelled">{{ t('batch.countCancelled', { count: cancelledCount }) }}</span>
        <span v-if="pendingCount > 0" class="result-count pending">{{ t('batch.countPending', { count: pendingCount }) }}</span>
      </div>

      <div class="results-list">
        <details
          v-for="result in results"
          :key="result.sessionId"
          class="result-item"
          :class="result.status"
          :open="result.status === 'error' || results.length <= 4"
        >
          <summary class="result-header">
            <AppIcon name="chevron-right" size="xs" class="result-chevron" />
            <div class="result-title-group">
              <span class="result-name">{{ result.displayName }}</span>
              <span class="result-meta">{{ result.sshAddress }}</span>
            </div>
            <span class="result-status">
              <template v-if="result.status === 'running'">{{ t('batch.statusRunning') }}</template>
              <template v-else-if="result.status === 'success'">{{ t('batch.statusSuccess') }}</template>
              <template v-else-if="result.status === 'error'">{{ t('batch.statusError') }}</template>
              <template v-else-if="result.status === 'cancelled'">{{ t('batch.statusCancelled') }}</template>
              <template v-else>{{ t('batch.statusPending') }}</template>
            </span>
          </summary>
          <div class="result-body">
            <div v-if="result.command && result.command !== sampleExpanded(commandInput)" class="result-cmd">
              <code>{{ result.command }}</code>
            </div>
            <div v-if="result.output" class="result-output">
              <pre>{{ result.output }}</pre>
            </div>
            <div v-if="result.error" class="result-error">
              {{ result.error }}
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-panel {
  width: 100%;
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  overflow: hidden;
}

.snippet-row {
  margin-bottom: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.snippet-select {
  flex: 1;
  min-width: 0;
}

.batch-header {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.batch-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-ui);
  font-weight: 600;
  color: var(--text-primary);
}

.batch-title-badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: var(--font-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.batch-sessions {
  padding: 10px 12px 6px;
}

.sessions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
}

.sessions-actions {
  display: flex;
  gap: 4px;
}

.sessions-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 112px;
  overflow-y: auto;
}

.session-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: 999px;
  background: var(--bg-secondary);
  font: inherit;
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.session-pill:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--text-primary) 18%, var(--border-color));
  color: var(--text-primary);
}

.session-pill.selected {
  background: var(--tab-selected-surface);
  border-color: color-mix(in srgb, var(--text-primary) 24%, var(--border-color));
  box-shadow: var(--tab-selected-shadow);
  color: var(--text-primary);
  font-weight: 600;
}

.session-pill:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.session-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.45;
  flex-shrink: 0;
}

.session-pill.selected .session-pill-dot {
  background: var(--accent);
  opacity: 1;
}

.session-pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-input {
  padding: 6px 12px 10px;
}

.batch-composer {
  border: 1px solid color-mix(in srgb, var(--text-primary) 12%, var(--border-color));
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.batch-composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border-color));
  box-shadow: 0 0 0 3px var(--accent-bg);
}

.command-textarea {
  width: 100%;
  resize: vertical;
  min-height: 60px;
  border: none;
  background: transparent;
  padding: 2px 4px;
}

.command-textarea:focus {
  box-shadow: none;
}

.composer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.input-options {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.timeout-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
}

.timeout-input {
  width: 60px;
}

.history-list {
  max-height: 120px;
  overflow-y: auto;
  margin-bottom: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  background: transparent;
  cursor: pointer;
  color: var(--text-primary);
}

.history-item:last-child {
  border-bottom: none;
}

.history-item:hover {
  background: var(--hover-bg);
}

.history-cmd {
  font-family: var(--font-mono);
  font-size: var(--font-ai-detail, 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  font-size: var(--font-caption);
  color: var(--text-secondary);
}

.preview-box {
  margin-top: 8px;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  padding: 8px 10px;
}

.preview-title {
  font-size: var(--font-ai-detail, 12px);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.preview-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.preview-row:last-child {
  border-bottom: none;
}

.preview-name {
  font-size: var(--font-ai-detail, 12px);
  font-weight: 600;
  color: var(--text-primary);
}

.preview-cmd {
  font-family: var(--font-mono);
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.batch-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.batch-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
}

.results-summary {
  display: flex;
  gap: 10px;
  padding: 8px 12px;
  font-size: var(--font-ai-detail, 12px);
  font-weight: 500;
}

.result-count.success { color: var(--success); }
.result-count.error { color: var(--danger); }
.result-count.cancelled { color: var(--text-secondary); }
.result-count.pending { color: var(--warning); }

.results-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-item {
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-primary);
  box-shadow: inset 0 1px 0 var(--mica-highlight, transparent);
  padding: 9px 11px;
}

.result-item.success { border-color: color-mix(in srgb, var(--success) 40%, var(--border-color)); }
.result-item.error { border-color: color-mix(in srgb, var(--danger) 40%, var(--border-color)); }
.result-item.cancelled { opacity: 0.75; }

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.result-header::-webkit-details-marker,
.result-header::marker {
  display: none;
  content: '';
}

.result-chevron {
  flex-shrink: 0;
  color: var(--text-secondary);
  transition: transform 0.12s ease;
}

.result-item[open] > .result-header .result-chevron {
  transform: rotate(90deg);
}

.result-body {
  margin-top: 6px;
}

.result-title-group {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.result-name {
  font-size: var(--font-ui-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-meta {
  font-size: var(--font-caption);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-status {
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.result-item.success .result-status { color: var(--success); }
.result-item.error .result-status { color: var(--danger); }

.result-cmd {
  margin-bottom: 6px;
}

.result-cmd code {
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
}

.result-output pre {
  margin: 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--font-ai-detail, 12px);
  font-family: var(--font-mono);
  max-height: 160px;
  overflow: auto;
}

.result-error {
  font-size: var(--font-ai-detail, 12px);
  color: var(--danger);
  margin-top: 4px;
}
</style>
