<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useBatchCommand, type BatchCommandTarget } from '@/composables/snippets/useBatchCommand'
import type { CommandSnippet } from '@/env.d'
import { resolveSnippetCommand } from '@/utils/snippets/commandSnippets'

const { t } = useI18n()

const props = defineProps<{
  sessions: BatchCommandTarget[]
  /** Prefill from command snippets panel */
  initialCommand?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'clear-initial'): void
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

/** Group open sessions by connection for bulk select */
const sessionGroups = computed(() => {
  const map = new Map<string, { key: string; label: string; sessions: BatchCommandTarget[] }>()
  for (const s of props.sessions) {
    const key = s.connectionId || s.connectionName
    let g = map.get(key)
    if (!g) {
      g = { key, label: s.connectionName, sessions: [] }
      map.set(key, g)
    }
    g.sessions.push(s)
  }
  return [...map.values()]
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

function toggleGroup(group: { sessions: BatchCommandTarget[] }) {
  const ids = group.sessions.map((s) => s.id)
  const allOn = ids.every((id) => selectedSessions.value.has(id))
  const next = new Set(selectedSessions.value)
  if (allOn) {
    for (const id of ids) next.delete(id)
  } else {
    for (const id of ids) next.add(id)
  }
  selectedSessions.value = next
}

function groupChecked(group: { sessions: BatchCommandTarget[] }): boolean {
  return group.sessions.length > 0 && group.sessions.every((s) => selectedSessions.value.has(s.id))
}

function groupIndeterminate(group: { sessions: BatchCommandTarget[] }): boolean {
  const n = group.sessions.filter((s) => selectedSessions.value.has(s.id)).length
  return n > 0 && n < group.sessions.length
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

async function handleExport() {
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

onMounted(loadSnippets)
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
          <button type="button" class="ui-btn ui-btn-xs" @click="selectAll">{{ t('batch.selectAll') }}</button>
          <button type="button" class="ui-btn ui-btn-xs" @click="selectNone">{{ t('batch.selectNone') }}</button>
        </div>
      </div>
      <div class="sessions-list">
        <div v-for="group in sessionGroups" :key="group.key" class="session-group">
          <label class="session-group-head">
            <input
              type="checkbox"
              :checked="groupChecked(group)"
              :indeterminate.prop="groupIndeterminate(group)"
              :disabled="isRunning"
              @change="toggleGroup(group)"
            />
            <span class="session-group-label">{{ group.label }}</span>
            <span class="session-group-count">{{ group.sessions.length }}</span>
          </label>
          <label
            v-for="session in group.sessions"
            :key="session.id"
            class="session-checkbox"
          >
            <input
              type="checkbox"
              :checked="selectedSessions.has(session.id)"
              :disabled="isRunning"
              @change="toggleSession(session.id)"
            />
            <span class="session-text">
              <span class="session-name">{{ session.displayName }}</span>
              <span class="session-meta">{{ session.sshAddress }}</span>
            </span>
          </label>
        </div>
      </div>
    </div>

    <div class="batch-input">
      <div class="snippet-row">
        <select
          v-model="snippetSelect"
          class="ui-input ui-input-sm snippet-select"
          :disabled="isRunning || snippetOptions.length === 0"
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
          class="ui-btn ui-btn-xs"
          :class="{ active: showHistory }"
          :title="t('batch.recentCommands')"
          @click="showHistory = !showHistory"
        >{{ t('batch.history') }}</button>
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
      <textarea
        v-model="commandInput"
        class="ui-textarea ui-input-sm ui-input-mono command-textarea"
        :placeholder="t('batch.commandPlaceholder')"
        rows="3"
        @keydown="handleKeydown"
        :disabled="isRunning"
      />
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
          class="ui-btn ui-btn-xs"
          :disabled="!commandInput.trim() || selectedSessions.size === 0"
          @click="showPreview = !showPreview"
        >{{ showPreview ? t('batch.collapsePreview') : t('batch.expandPreview') }}</button>
      </div>
      <div v-if="showPreview && previewRows.length" class="preview-box">
        <div class="preview-title">{{ t('batch.previewTitle', { count: previewRows.length }) }}</div>
        <div v-for="row in previewRows" :key="row.sessionId" class="preview-row">
          <span class="preview-name">{{ row.displayName }}</span>
          <code class="preview-cmd">{{ row.command }}</code>
        </div>
      </div>
    </div>

    <div class="batch-actions">
      <button
        v-if="!isRunning"
        class="ui-btn ui-btn-primary execute-btn"
        :disabled="!canExecute"
        @click="handleExecute"
      >
        <AppIcon name="play" size="sm" />
        <span>{{ t('batch.execute') }}</span>
      </button>
      <button
        v-else
        class="ui-btn ui-btn-danger execute-btn"
        type="button"
        @click="handleCancel"
      >
        <AppIcon name="refresh" size="sm" class="spin-icon" />
        <span>{{ t('batch.cancel') }}</span>
      </button>
      <button v-if="hasResults && !isRunning" type="button" class="ui-btn ui-btn-sm" @click="handleExport">{{ t('batch.exportResults') }}</button>
      <button v-if="hasResults" type="button" class="ui-btn ui-btn-sm" :disabled="isRunning" @click="clearResults">{{ t('batch.clearResults') }}</button>
    </div>

    <div v-if="hasResults" class="batch-results">
      <div class="results-summary">
        <span v-if="successCount > 0" class="result-count success">{{ t('batch.countSuccess', { count: successCount }) }}</span>
        <span v-if="errorCount > 0" class="result-count error">{{ t('batch.countError', { count: errorCount }) }}</span>
        <span v-if="cancelledCount > 0" class="result-count cancelled">{{ t('batch.countCancelled', { count: cancelledCount }) }}</span>
        <span v-if="pendingCount > 0" class="result-count pending">{{ t('batch.countPending', { count: pendingCount }) }}</span>
      </div>

      <div class="results-list">
        <div
          v-for="result in results"
          :key="result.sessionId"
          class="result-item"
          :class="result.status"
        >
          <div class="result-header">
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
          </div>
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
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  overflow: hidden;
}

.snippet-row {
  margin-bottom: 6px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.snippet-select {
  flex: 1;
  min-width: 0;
}

.batch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.batch-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.batch-title-badge {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
}

.batch-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
}

.batch-close:hover {
  background: var(--hover-bg);
  color: var(--danger);
}

.batch-sessions {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.sessions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.sessions-actions {
  display: flex;
  gap: 4px;
}

.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}

.session-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 4px;
}

.session-group-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-group-count {
  font-weight: 500;
  opacity: 0.7;
}

.session-checkbox {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px 6px 22px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  font-size: 11px;
  color: var(--text-primary);
  cursor: pointer;
}

.session-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.session-name {
  font-weight: 600;
}

.session-meta {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.batch-input {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.command-textarea {
  width: 100%;
  resize: vertical;
  min-height: 64px;
}

.input-options {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.timeout-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.timeout-input {
  width: 64px;
}

.history-list {
  max-height: 100px;
  overflow-y: auto;
  margin-bottom: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.history-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: none;
  border-bottom: 1px solid var(--border-color);
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
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  font-size: 10px;
  color: var(--text-secondary);
}

.preview-box {
  margin-top: 8px;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  padding: 6px 8px;
}

.preview-title {
  font-size: 11px;
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
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.preview-cmd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.batch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.execute-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.spin-icon {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.batch-results {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.results-summary {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  font-size: 11px;
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
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  padding: 8px 10px;
}

.result-item.success { border-color: color-mix(in srgb, var(--success) 40%, var(--border-color)); }
.result-item.error { border-color: color-mix(in srgb, var(--danger) 40%, var(--border-color)); }
.result-item.cancelled { opacity: 0.75; }

.result-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.result-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.result-name {
  font-size: 12px;
  font-weight: 600;
}

.result-meta {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.result-status {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.result-cmd {
  margin-bottom: 4px;
}

.result-cmd code {
  font-size: 10px;
  color: var(--text-secondary);
}

.result-output pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  font-family: var(--font-mono);
  max-height: 160px;
  overflow: auto;
}

.result-error {
  font-size: 11px;
  color: var(--danger);
  margin-top: 4px;
}

.ui-btn-danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.ui-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
