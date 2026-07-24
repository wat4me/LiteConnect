<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiHistorySummary, AiSettings } from '../env.d.ts'
import { useAiChat, type ChatItem } from '../composables/useAiChat'
import { appConfirm } from '../composables/useAppDialog'
import {
  buildAiTerminalConfirmCopy,
  normalizeTerminalText,
} from '../utils/terminalPaste'
import AppIcon from './icons/AppIcon.vue'
import AiHistoryList from './AiHistoryList.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AiChatView from './AiChatView.vue'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  selectionRequest?: {
    id: number
    sessionId: string
    text: string
    mode: 'send' | 'insert'
  } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'selectionConsumed', id: number): void
}>()

const {
  settings,
  activeProvider,
  displayModelName,
  sendText,
  stopGeneration,
  clearMessages,
  loadHistory,
  getSessionState,
  saveSessionInput,
} = useAiChat()

const messages = ref<ChatItem[]>([])
const input = ref('')
const loading = ref(false)
const showSettings = ref(false)
const showHistory = ref(false)
const showModelSwitcher = ref(false)
const historyList = ref<AiHistorySummary[]>([])
const consumedSelectionIds = new Set<number>()
const settingsPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)

const contextChips = computed(() => {
  const chips: { id: string; label: string }[] = []
  chips.push({ id: 'session', label: t('ai.sessionChip', { id: props.sessionId.slice(0, 8) }) })
  if (displayModelName.value) {
    chips.push({ id: 'model', label: displayModelName.value })
  }
  const p = activeProvider.value
  if (p?.name) chips.push({ id: 'provider', label: p.name })
  return chips
})

const hasApiConfigured = computed(() => {
  const list = settings.value.providers || []
  return list.some((p) => (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0)
})

let initialLoadPromise: Promise<void> | null = null
let historyListLoaded = false

const canSend = computed(() => input.value.trim().length > 0 && !loading.value)

const modelSwitcherGroups = computed(() => {
  return (settings.value.providers || [])
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      providerId: p.id,
      providerName: p.name,
      models: p.models.map((m) => ({
        providerId: p.id,
        model: m,
        label: m,
        active: p.id === settings.value.activeProviderId && m === settings.value.activeModel,
      })),
    }))
    .filter((g) => g.models.length > 0)
})

function syncMessages(msgs: ChatItem[]) {
  messages.value = msgs
}

onMounted(() => {
  const state = getSessionState(props.sessionId)
  messages.value = state.messages
  input.value = state.input
  loading.value = state.loading
  ensureInitialLoad().catch(() => {})
})

onBeforeUnmount(() => {
  saveSessionInput(props.sessionId, input.value)
})

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (oldId) saveSessionInput(oldId, input.value)
    const state = getSessionState(newId)
    messages.value = state.messages
    input.value = state.input
    loading.value = state.loading
    initialLoadPromise = null
    await ensureInitialLoad()
  }
)

watch(input, (value) => {
  saveSessionInput(props.sessionId, value)
})

watch(showHistory, (value) => {
  if (value) {
    void ensureHistoryListLoaded()
  }
})

watch(
  () => props.selectionRequest,
  async (request) => {
    if (!request?.text) return
    if (request.sessionId !== props.sessionId) return
    if (consumedSelectionIds.has(request.id)) return
    await ensureInitialLoad()
    consumedSelectionIds.add(request.id)
    emit('selectionConsumed', request.id)

    if (request.mode === 'insert') {
      input.value = request.text
      return
    }
    const sent = await handleSendText(request.text)
    if (!sent) input.value = request.text
  },
  { immediate: true }
)

async function loadHistoryList() {
  try {
    historyList.value = await window.LiteConnect.listAiSessionHistories()
    historyListLoaded = true
  } catch {
    historyList.value = []
    historyListLoaded = false
  }
}

async function ensureHistoryListLoaded(force = false) {
  if (historyListLoaded && !force) return
  await loadHistoryList()
}

async function loadHistorySession(sessionId: string) {
  try {
    const records = await window.LiteConnect.getAiSessionHistory(sessionId)
    const items = records.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      reasoningContent: r.reasoningContent,
      usage: r.usage,
      error: r.error,
      createdAt: r.createdAt,
    }))
    // Prefer full history of the selected session file; also mirror into that session's memory state
    const state = getSessionState(sessionId)
    state.messages.splice(0, state.messages.length, ...items)
    // Show in current panel (history may be from another SSH session id)
    messages.value = items
    showHistory.value = false
    if (items.every((m) => m.role === 'user')) {
      ElMessage.info(t('ai.historyUserOnly'))
    }
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.loadHistoryFailed'))
  }
}

async function ensureInitialLoad() {
  if (!initialLoadPromise) {
    initialLoadPromise = (async () => {
      try {
        settings.value = await window.LiteConnect.getAiSettings()
        settingsPanelRef.value?.applyExternal(settings.value)
      } catch (err: any) {
        ElMessage.warning(err?.message || t('ai.loadSettingsFailed'))
      }
      const history = await loadHistory(props.sessionId)
      const state = getSessionState(props.sessionId)
      if (state.messages.length === 0 && history.length > 0) {
        state.messages.push(...history)
      }
      syncMessages(state.messages)
    })()
  }
  await initialLoadPromise
}

function onSettingsSaved(next: AiSettings) {
  settings.value = next
}

async function switchModel(providerId: string, model: string) {
  showModelSwitcher.value = false
  if (!model) return
  try {
    const updated = await window.LiteConnect.switchAiModel(providerId, model)
    settings.value = updated
    settingsPanelRef.value?.applyExternal(updated)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.switchModelFailed'))
  }
}

async function handleSendText(text: string): Promise<boolean> {
  const content = text.trim()
  if (!content) return false
  loading.value = true
  const result = await sendText(props.sessionId, content, syncMessages)
  loading.value = getSessionState(props.sessionId).loading
  return result
}

async function sendMessage() {
  if (!canSend.value) return
  const content = input.value.trim()
  input.value = ''
  await handleSendText(content)
}

async function handleStop() {
  await stopGeneration(props.sessionId)
  loading.value = getSessionState(props.sessionId).loading
}

function openSettingsCta() {
  showSettings.value = true
  showHistory.value = false
}

function openHistoryPanel() {
  showHistory.value = !showHistory.value
  if (showHistory.value) showSettings.value = false
}

function openSettingsPanel() {
  showSettings.value = !showSettings.value
  if (showSettings.value) showHistory.value = false
}

function closeHistoryPanel() {
  showHistory.value = false
}

function closeSettingsPanel() {
  showSettings.value = false
}

async function deleteHistorySession(sessionId: string) {
  try {
    await appConfirm({
      title: t('ai.deleteHistoryTitle'),
      message: t('ai.deleteHistoryMessage'),
      detail: t('ai.deleteHistoryDetail'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  try {
    await window.LiteConnect.clearAiSessionHistory(sessionId)
    const state = getSessionState(sessionId)
    state.messages.splice(0, state.messages.length)
    if (sessionId === props.sessionId) {
      syncMessages(state.messages)
    }
    await loadHistoryList()
    ElMessage.success(t('ai.historyDeleted'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.deleteHistoryFailed'))
  }
}

async function clearAllHistories() {
  if (historyList.value.length === 0) return
  try {
    await appConfirm({
      title: t('ai.clearAllHistoryTitle'),
      message: t('ai.clearAllHistoryMessage', { count: historyList.value.length }),
      confirmText: t('ai.clear'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  try {
    const ids = historyList.value.map((item) => item.sessionId)
    await Promise.all(ids.map((id) => window.LiteConnect.clearAiSessionHistory(id)))
    for (const id of ids) {
      const state = getSessionState(id)
      state.messages.splice(0, state.messages.length)
    }
    const current = getSessionState(props.sessionId)
    syncMessages(current.messages)
    await loadHistoryList()
    ElMessage.success(t('ai.allHistoryCleared'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.clearHistoryFailed'))
  }
}

async function confirmAiTerminalAction(action: 'fill' | 'run', code: string): Promise<string | null> {
  const text = normalizeTerminalText(code)
  if (!text.trim()) return null
  const copy = buildAiTerminalConfirmCopy(action, text)
  try {
    await appConfirm({
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      confirmText: copy.confirmText,
      cancelText: t('common.cancel'),
      danger: copy.danger,
      tone: copy.tone,
    })
  } catch {
    return null
  }
  return text
}

async function fillCodeToTerminal(code: string) {
  const text = await confirmAiTerminalAction('fill', code)
  if (!text) return
  try {
    window.LiteConnect.sshWrite(props.sessionId, text)
    ElMessage.success(t('ai.filledTerminal'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.fillFailed'))
  }
}

async function runCodeToTerminal(code: string) {
  const text = await confirmAiTerminalAction('run', code)
  if (!text) return
  const payload = text.endsWith('\n') ? text : `${text}\n`
  try {
    window.LiteConnect.sshWrite(props.sessionId, payload)
    ElMessage.success(t('ai.sentTerminal'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.sendFailed'))
  }
}

function handleClearMessages() {
  clearMessages(props.sessionId, syncMessages)
  historyListLoaded = false
  if (showHistory.value) {
    loadHistoryList().catch(() => {})
  }
}
</script>

<template>
  <div class="ai-sidebar">
    <div class="ai-header">
      <div class="ai-header-title-area">
        <div class="ai-title">{{ t('ai.title') }}</div>
      </div>
      <div class="ai-header-actions">
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showHistory }" @click="openHistoryPanel" :title="t('ai.history')">
          <AppIcon name="history" :size="14" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showSettings }" @click="openSettingsPanel" :title="t('ai.settings')">
          <AppIcon name="settings" :size="14" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('ai.closePanel')">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>

    <AiHistoryList
      v-if="showHistory"
      :items="historyList"
      @select="loadHistorySession"
      @close="closeHistoryPanel"
      @clear-all="clearAllHistories"
      @delete="deleteHistorySession"
    />

    <AiSettingsPanel
      v-if="showSettings"
      ref="settingsPanelRef"
      :model-value="settings"
      @saved="onSettingsSaved"
      @close="closeSettingsPanel"
    />

    <div v-if="contextChips.length" class="context-chips" :aria-label="t('ai.contextAria')">
      <span v-for="chip in contextChips" :key="chip.id" class="context-chip">{{ chip.label }}</span>
    </div>

    <AiChatView
      :messages="messages"
      :has-api-configured="hasApiConfigured"
      @open-settings="openSettingsCta"
      @fill-code="fillCodeToTerminal"
      @run-code="runCodeToTerminal"
    />

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        class="ui-textarea ui-input-sm composer-input"
        rows="3"
        :placeholder="t('ai.inputPlaceholder')"
        @keydown.enter.exact.prevent="sendMessage"
        @keydown.shift.enter.stop
        @keydown.ctrl.enter.prevent="sendMessage"
        @keydown.meta.enter.prevent="sendMessage"
      />
      <div class="composer-actions">
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="handleClearMessages" :title="t('ai.clearChat')">
          <AppIcon name="delete" :size="14" />
        </button>
        <div class="composer-actions-right">
          <div class="model-switcher-wrap">
            <button
              v-if="displayModelName"
              type="button"
              class="ai-model-switcher"
              :class="{ active: showModelSwitcher }"
              @click="showModelSwitcher = !showModelSwitcher"
              :title="activeProvider ? `${activeProvider.name} · ${displayModelName}` : displayModelName"
            >
              <span class="ai-model-switcher-name">{{ displayModelName }}</span>
              <AppIcon name="chevron-down" :size="12" />
            </button>
            <div
              v-if="showModelSwitcher && modelSwitcherGroups.length > 0"
              class="model-switcher-dropdown"
            >
              <div
                v-for="group in modelSwitcherGroups"
                :key="group.providerId"
                class="model-switcher-group"
              >
                <div class="model-switcher-group-title">{{ group.providerName }}</div>
                <button
                  v-for="item in group.models"
                  :key="item.providerId + item.model"
                  type="button"
                  class="model-switcher-item"
                  :class="{ active: item.active }"
                  @click="switchModel(item.providerId, item.model)"
                >
                  <span>{{ item.label }}</span>
                  <AppIcon v-if="item.active" name="check" :size="14" />
                </button>
              </div>
            </div>
            <div
              v-if="showModelSwitcher"
              class="model-switcher-overlay"
              @click="showModelSwitcher = false"
            ></div>
          </div>
          <button
            v-if="loading"
            type="button"
            class="stop-btn"
            :title="t('ai.stopGenerate')"
            @click="handleStop"
          >
            {{ t('common.stop') }}
          </button>
          <button v-else type="submit" class="send-btn" :disabled="!canSend">
            <AppIcon name="send" :size="14" />
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.ai-sidebar {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.ai-header {
  min-height: 48px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
}

.ai-header-title-area {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ai-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.model-switcher-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.ai-model-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  min-height: 28px;
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  cursor: pointer;
  transition: all 0.15s;
}

.ai-model-switcher:hover,
.ai-model-switcher.active {
  background: var(--bg-primary);
  border-color: var(--accent);
  color: var(--text-primary);
}

.ai-model-switcher-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-switcher-overlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.model-switcher-dropdown {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 9999;
  min-width: 200px;
  max-width: 280px;
  padding: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  max-height: 280px;
  overflow-y: auto;
}

.model-switcher-group + .model-switcher-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.model-switcher-group-title {
  padding: 4px 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary);
}

.model-switcher-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  cursor: pointer;
  text-align: left;
}

.model-switcher-item:hover {
  background: var(--hover-bg);
}

.model-switcher-item.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.ai-header-actions,
.composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.send-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-input {
  resize: none;
  min-height: 64px;
  background: var(--bg-secondary);
}

.stop-btn {
  border: 1px solid var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.stop-btn:hover {
  background: color-mix(in srgb, var(--danger) 22%, transparent);
}

.composer {
  padding: 10px;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.composer-actions {
  justify-content: space-between;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
