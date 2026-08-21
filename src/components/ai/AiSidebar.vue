<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiSettings } from '../../env.d.ts'
import { useAiChat, type ChatItem } from '../../composables/ai/useAiChat'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  buildAiTerminalConfirmCopy,
  normalizeTerminalText,
} from '@/utils/terminal/terminalPaste'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import AppIcon from '../icons/AppIcon.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AiChatView from './AiChatView.vue'
import { aiModelId, formatTokenCount, packAiMessages } from '@shared/aiContext'

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
  activeContextWindowTokens,
  sendText,
  stopGeneration,
  clearMessages,
  loadHistory,
  getSessionState,
  saveSessionInput,
  startNewConversation,
  switchConversation,
  deleteConversation,
  clearAllConversations,
  regenerateMessage,
  retryMessage,
  prepareEditUserMessage,
  deleteMessage,
} = useAiChat()

const messages = ref<ChatItem[]>([])
const input = ref('')
const loading = ref(false)
const showSettings = ref(false)
const showHistory = ref(false)
const showModelSwitcher = ref(false)
const threadSummaries = ref(getSessionState(props.sessionId).threads)
const consumedSelectionIds = new Set<number>()
const settingsPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)
const historyButtonRef = ref<HTMLButtonElement | null>(null)
const settingsButtonRef = ref<HTMLButtonElement | null>(null)
const modelSwitcherButtonRef = ref<HTMLButtonElement | null>(null)
const modelSwitcherDropdownRef = ref<HTMLElement | null>(null)
const modelSwitcherStyle = ref<Record<string, string>>({})
const popoverRef = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})

const hasApiConfigured = computed(() => {
  const list = settings.value.providers || []
  return list.some((p) => (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0)
})

let initialLoadPromise: Promise<void> | null = null
const canSend = computed(() => input.value.trim().length > 0 && !loading.value)

const currentThreadTitle = computed(() => {
  const active = threadSummaries.value.find((t) => t.active)
  const title = (active?.title || '').trim()
  return title || t('ai.newConversationTitle')
})

const contextPack = computed(() => {
  const conv = messages.value
    .filter(
      (m) =>
        !m.error &&
        !m.streaming &&
        (m.role === 'user' || m.role === 'assistant') &&
        m.content.trim(),
    )
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const draft = input.value.trim()
  if (draft) conv.push({ role: 'user', content: draft })
  return packAiMessages({
    systemPrompt: settings.value.systemPrompt,
    messages: conv,
    model: settings.value.activeModel || displayModelName.value,
    contextWindowTokens: activeContextWindowTokens.value,
  })
})

const CONTEXT_RING = { size: 20, radius: 7 }

const contextRatio = computed(() => {
  const budget = contextPack.value.budgetTokens
  if (budget <= 0) return 0
  return Math.min(1, Math.max(0, contextPack.value.promptTokens / budget))
})

const contextTone = computed<'ok' | 'warn' | 'danger'>(() => {
  if (contextPack.value.droppedCount > 0 || contextRatio.value >= 0.85) return 'danger'
  if (contextRatio.value >= 0.6) return 'warn'
  return 'ok'
})

const contextRingDash = computed(() => {
  const circ = 2 * Math.PI * CONTEXT_RING.radius
  const filled = circ * contextRatio.value
  return { circ, filled }
})

/** Meter is a local estimate of the next send — never implies a request already went out. */
const showContextMeter = computed(() => {
  if (input.value.trim()) return true
  return messages.value.some(
    (m) =>
      !m.error &&
      !m.streaming &&
      (m.role === 'user' || m.role === 'assistant') &&
      m.content.trim(),
  )
})

const contextMeterTitle = computed(() =>
  t('ai.contextUsage', {
    used: formatTokenCount(contextPack.value.promptTokens),
    budget: formatTokenCount(contextPack.value.budgetTokens),
  }),
)

/** History panel: only threads that actually have messages (hide empty active draft). */
const historyItems = computed(() =>
  threadSummaries.value
    .filter((thread) => (thread.messageCount || 0) > 0)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => ({
      id: thread.id,
      title: thread.title || t('ai.newConversationTitle'),
      createdAt: thread.updatedAt || thread.createdAt,
      messageCount: thread.messageCount,
      active: thread.active || thread.id === getSessionState(props.sessionId).activeThreadId,
    })),
)

const modelSwitcherGroups = computed(() => {
  return (settings.value.providers || [])
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      providerId: p.id,
      providerName: p.name,
      models: p.models.map((m) => {
        const id = aiModelId(m)
        return {
          providerId: p.id,
          model: id,
          label: id,
          active: p.id === settings.value.activeProviderId && id === settings.value.activeModel,
        }
      }).filter((item) => item.model),
    }))
    .filter((g) => g.models.length > 0)
})

function syncMessages(msgs: ChatItem[]) {
  messages.value = msgs
  threadSummaries.value = getSessionState(props.sessionId).threads.slice()
}

function syncFromState() {
  const state = getSessionState(props.sessionId)
  messages.value = state.messages
  input.value = state.input
  loading.value = state.loading
  threadSummaries.value = state.threads.slice()
}

onMounted(() => {
  syncFromState()
  ensureInitialLoad().catch(() => {})
  document.addEventListener('pointerdown', closePopoverOnOutsideClick)
  document.addEventListener('keydown', closePopoverOnEscape)
  window.addEventListener('resize', repositionPopover)
})

onBeforeUnmount(() => {
  saveSessionInput(props.sessionId, input.value)
  document.removeEventListener('pointerdown', closePopoverOnOutsideClick)
  document.removeEventListener('keydown', closePopoverOnEscape)
  window.removeEventListener('resize', repositionPopover)
})

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (oldId) saveSessionInput(oldId, input.value)
    syncFromState()
    initialLoadPromise = null
    await ensureInitialLoad()
  }
)

watch(input, (value) => {
  saveSessionInput(props.sessionId, value)
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

async function handleNewConversation() {
  if (loading.value) return
  await startNewConversation(props.sessionId, syncMessages)
  syncFromState()
}

async function handleSwitchConversation(threadId: string) {
  if (loading.value) return
  await switchConversation(props.sessionId, threadId, syncMessages)
  syncFromState()
  closeHistoryPanel()
}

async function handleDeleteConversation(threadId: string, event?: Event) {
  event?.stopPropagation()
  try {
    await appConfirm({
      title: t('ai.deleteHistoryTitle'),
      message: t('ai.deleteHistoryMessage'),
      detail: t('ai.deleteHistoryDetail'),
      confirmText: t('ai.clear'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  const ok = await deleteConversation(props.sessionId, threadId, syncMessages)
  if (ok) ElMessage.success(t('ai.historyDeleted'))
}

async function handleClearAllHistory() {
  const count = historyItems.value.length
  if (count === 0) return
  try {
    await appConfirm({
      title: t('ai.clearAllHistoryTitle'),
      message: t('ai.clearAllHistoryMessage', { count }),
      confirmText: t('ai.clear'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  const ok = await clearAllConversations(props.sessionId, syncMessages)
  if (ok) ElMessage.success(t('ai.allHistoryCleared'))
}

async function handleRegenerate(messageId: string) {
  loading.value = true
  try {
    await regenerateMessage(props.sessionId, messageId, syncMessages)
  } finally {
    loading.value = getSessionState(props.sessionId).loading
  }
}

async function handleRetry(messageId: string) {
  loading.value = true
  try {
    await retryMessage(props.sessionId, messageId, syncMessages)
  } finally {
    loading.value = getSessionState(props.sessionId).loading
  }
}

async function handleEditMessage(messageId: string) {
  const text = await prepareEditUserMessage(props.sessionId, messageId, syncMessages)
  if (text == null) return
  input.value = text
}

async function handleDeleteMessage(messageId: string) {
  try {
    await appConfirm({
      title: t('ai.deleteMessageTitle'),
      message: t('ai.deleteMessageConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  await deleteMessage(props.sessionId, messageId, syncMessages)
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

async function positionModelSwitcher() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const btn = modelSwitcherButtonRef.value
  const dropdown = modelSwitcherDropdownRef.value
  if (!btn || !dropdown) return
  const rect = btn.getBoundingClientRect()
  const size = {
    width: dropdown.offsetWidth || 200,
    height: dropdown.offsetHeight || 120,
  }
  const pos = placePopupNearAnchor(rect, size, { align: 'end', gap: 6, prefer: 'above' })
  const next: Record<string, string> = {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
  }
  if (pos.maxHeight > 0) next.maxHeight = `${pos.maxHeight}px`
  modelSwitcherStyle.value = next
}

watch(showModelSwitcher, (open) => {
  if (open) void positionModelSwitcher()
})

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

async function openSettingsCta() {
  showSettings.value = true
  showHistory.value = false
  await nextTick()
  await positionPopover(settingsButtonRef.value, 330)
}

async function openSettingsPanel() {
  showSettings.value = true
  showHistory.value = false
  await nextTick()
  await positionPopover(settingsButtonRef.value, 330)
}

function closeSettingsPanel() {
  showSettings.value = false
}

async function openHistoryPanel() {
  showHistory.value = true
  showSettings.value = false
  await nextTick()
  await positionPopover(historyButtonRef.value, 330)
}

function closeHistoryPanel() {
  showHistory.value = false
}

function formatHistoryTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function positionPopover(trigger: HTMLElement | null, preferredWidth: number) {
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(preferredWidth, window.innerWidth - 16)
  // Provisional placement below trigger; refined after popover mounts
  const provisionalLeft = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
  popoverStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${provisionalLeft}px`,
    width: `${width}px`,
  }
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const el = popoverRef.value
  if (!el) return
  const size = { width: el.offsetWidth || width, height: el.offsetHeight || 200 }
  const pos = placePopupNearAnchor(rect, size, { align: 'end', gap: 8 })
  const next: Record<string, string> = {
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    width: `${width}px`,
  }
  if (pos.maxHeight > 0) next.maxHeight = `${pos.maxHeight}px`
  popoverStyle.value = next
}

function repositionPopover() {
  if (showSettings.value) void positionPopover(settingsButtonRef.value, 330)
  else if (showHistory.value) void positionPopover(historyButtonRef.value, 330)
}

function closePopoverOnOutsideClick(event: PointerEvent) {
  if (!showSettings.value && !showHistory.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (popoverRef.value?.contains(target)) return
  if (historyButtonRef.value?.contains(target) || settingsButtonRef.value?.contains(target)) return
  closeSettingsPanel()
  closeHistoryPanel()
}

function closePopoverOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeSettingsPanel()
  closeHistoryPanel()
}

async function clearCurrentHistory() {
  if (messages.value.length === 0) return
  try {
    await appConfirm({
      title: t('ai.clearHistoryTitle'),
      message: t('ai.clearHistoryMessage'),
      confirmText: t('ai.clear'),
      cancelText: t('common.cancel'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  clearMessages(props.sessionId, syncMessages)
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
}
</script>

<template>
  <div class="ai-sidebar">
    <div class="ai-header">
      <div class="ai-header-title-area">
        <div class="ai-title" :title="currentThreadTitle">{{ currentThreadTitle }}</div>
      </div>
      <div class="ai-header-actions">
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          :disabled="loading"
          :title="t('ai.newConversation')"
          @click="handleNewConversation"
        >
          <AppIcon name="plus" size="sm" />
        </button>
        <button ref="historyButtonRef" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showHistory }" @click="openHistoryPanel" :title="t('ai.history')">
          <AppIcon name="history" size="sm" />
        </button>
        <button ref="settingsButtonRef" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showSettings }" @click="openSettingsPanel" :title="t('ai.settings')">
          <AppIcon name="settings" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('ai.closePanel')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div class="ai-body">
      <AiChatView
        :messages="messages"
        :has-api-configured="hasApiConfigured"
        :loading="loading"
        :context-dropped-count="contextPack.droppedCount"
        @open-settings="openSettingsCta"
        @fill-code="fillCodeToTerminal"
        @run-code="runCodeToTerminal"
        @regenerate="handleRegenerate"
        @retry="handleRetry"
        @edit-message="handleEditMessage"
        @delete-message="handleDeleteMessage"
        @use-example="(text) => { input = text }"
      />
    </div>

    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        class="composer-input"
        rows="2"
        :placeholder="t('ai.inputPlaceholder')"
        :title="t('ai.inputHint')"
        @keydown.enter.exact.prevent="sendMessage"
        @keydown.shift.enter.stop
        @keydown.ctrl.enter.prevent="sendMessage"
        @keydown.meta.enter.prevent="sendMessage"
      />
      <div class="composer-actions">
        <button type="button" class="composer-clear" @click="handleClearMessages" :title="t('ai.clearChat')">
          {{ t('ai.clear') }}
        </button>
        <span
          v-if="showContextMeter"
          class="context-ring"
          :class="contextTone"
          :aria-label="contextMeterTitle"
        >
          <svg
            :width="CONTEXT_RING.size"
            :height="CONTEXT_RING.size"
            :viewBox="`0 0 ${CONTEXT_RING.size} ${CONTEXT_RING.size}`"
            aria-hidden="true"
          >
            <circle
              class="context-ring-track"
              :cx="CONTEXT_RING.size / 2"
              :cy="CONTEXT_RING.size / 2"
              :r="CONTEXT_RING.radius"
            />
            <circle
              class="context-ring-fill"
              :cx="CONTEXT_RING.size / 2"
              :cy="CONTEXT_RING.size / 2"
              :r="CONTEXT_RING.radius"
              :stroke-dasharray="`${contextRingDash.filled} ${contextRingDash.circ}`"
              :transform="`rotate(-90 ${CONTEXT_RING.size / 2} ${CONTEXT_RING.size / 2})`"
            />
          </svg>
          <span class="context-ring-tip" role="tooltip">{{ contextMeterTitle }}</span>
        </span>
        <div class="composer-actions-right">
          <div class="model-switcher-wrap">
            <button
              v-if="displayModelName"
              ref="modelSwitcherButtonRef"
              type="button"
              class="ai-model-switcher"
              :class="{ active: showModelSwitcher }"
              @click="showModelSwitcher = !showModelSwitcher"
              :title="activeProvider ? `${activeProvider.name} · ${displayModelName}` : displayModelName"
            >
              <span class="ai-model-switcher-name">{{ displayModelName }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </button>
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
            <AppIcon name="send" size="sm" />
          </button>
        </div>
      </div>
    </form>

    <Teleport to="body">
      <div
        v-if="showModelSwitcher && modelSwitcherGroups.length > 0"
        ref="modelSwitcherDropdownRef"
        class="model-switcher-dropdown"
        :style="modelSwitcherStyle"
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
            <AppIcon v-if="item.active" name="check" size="sm" />
          </button>
        </div>
      </div>
      <div
        v-if="showModelSwitcher"
        class="model-switcher-overlay"
        @click="showModelSwitcher = false"
      ></div>
    </Teleport>

  </div>

  <Teleport to="body">
    <div
      v-if="showSettings"
      ref="popoverRef"
      class="ai-popover ai-settings-popover"
      :style="popoverStyle"
      role="dialog"
      :aria-label="t('ai.settings')"
    >
      <AiSettingsPanel
        ref="settingsPanelRef"
        :model-value="settings"
        @saved="onSettingsSaved"
        @close="closeSettingsPanel"
      />
    </div>

    <section
      v-if="showHistory"
      ref="popoverRef"
      class="ai-popover ai-history-popover"
      :style="popoverStyle"
      role="dialog"
      :aria-label="t('ai.history')"
    >
      <div class="ai-layer-header">
        <div class="ai-layer-heading">
          <span class="ai-layer-title">{{ t('ai.history') }}</span>
          <span class="ai-layer-subtitle">{{ t('ai.title') }}</span>
        </div>
        <div class="ai-layer-actions">
          <button
            type="button"
            class="ui-btn ui-btn-xs ui-btn-ghost"
            :disabled="historyItems.length === 0"
            @click="handleClearAllHistory"
          >
            {{ t('ai.clearAllHistory') }}
          </button>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.closeHistory')" @click="closeHistoryPanel">
            <AppIcon name="close" size="sm" />
          </button>
        </div>
      </div>
      <div v-if="historyItems.length === 0" class="ai-history-empty">{{ t('ai.emptyHistory') }}</div>
      <div v-else class="ai-history-list">
        <div
          v-for="item in historyItems"
          :key="item.id"
          class="ai-history-item"
          :class="{ active: item.active }"
        >
          <button
            type="button"
            class="ai-history-item-main"
            :title="item.title"
            @click="handleSwitchConversation(item.id)"
          >
            <span class="ai-history-item-title">{{ item.title }}</span>
            <span class="ai-history-item-meta">
              {{ t('ai.messageCount', { count: item.messageCount, time: formatHistoryTime(item.createdAt) }) }}
            </span>
          </button>
          <button
            type="button"
            class="ai-history-item-delete"
            :title="t('ai.deleteHistoryItem')"
            @click="handleDeleteConversation(item.id, $event)"
          >
            <AppIcon name="delete" size="xs" />
          </button>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.ai-sidebar {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.ai-popover {
  position: fixed;
  z-index: 10500;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
  max-height: calc(100vh - 16px);
}

.ai-settings-popover {
  width: min(330px, calc(100vw - 16px));
  height: min(420px, calc(100vh - 96px));
}

.ai-settings-popover :deep(.settings-box) {
  flex: 1;
  max-height: none;
  border-bottom: none;
}

.ai-history-popover {
  width: min(330px, calc(100vw - 16px));
  height: min(260px, calc(100vh - 96px));
}

.ai-layer-header {
  min-height: 48px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.ai-layer-heading,
.ai-layer-actions {
  display: flex;
  align-items: center;
}

.ai-layer-heading {
  min-width: 0;
  gap: 6px;
}

.ai-layer-title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.ai-layer-subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 10px;
}

.ai-layer-actions {
  flex-shrink: 0;
  gap: 6px;
}

.ai-history-list {
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

.ai-history-item {
  width: 100%;
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 4px;
  border-radius: 6px;
  color: var(--text-primary);
}

.ai-history-item:hover {
  background: var(--hover-bg);
}

.ai-history-item.active {
  background: var(--accent-bg);
}

.ai-history-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ai-history-item-delete {
  flex-shrink: 0;
  width: 28px;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
}

.ai-history-item:hover .ai-history-item-delete {
  opacity: 1;
}

.ai-history-item-delete:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.ai-history-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.ai-history-item-meta {
  color: var(--text-secondary);
  font-size: 10px;
}

.ai-history-empty {
  padding: 18px 10px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.ai-header {
  min-height: 44px;
  padding: 6px 10px 6px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--border-color);
}

.ai-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.ai-header-title-area {
  min-width: 0;
  flex: 1;
}

.ai-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-switcher-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.ai-model-switcher {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 128px;
  min-height: 28px;
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
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
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  max-width: 280px;
  padding: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  max-height: min(280px, calc(100vh - 16px));
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
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.composer-input {
  resize: none;
  min-height: 40px;
  max-height: 140px;
  border: none;
  outline: none;
  padding: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
}

.composer-input::placeholder {
  color: var(--text-secondary);
}

.composer-clear {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  padding: 0 2px;
  cursor: pointer;
}

.composer-clear:hover {
  color: var(--text-primary);
}

.context-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0 -4px;
  border-radius: 6px;
  flex-shrink: 0;
}

.context-ring svg {
  display: block;
  pointer-events: none;
}

.context-ring:hover {
  background: var(--hover-bg);
}

.context-ring-tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 6;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
}

.context-ring:hover .context-ring-tip {
  opacity: 1;
  visibility: visible;
}

.context-ring-track,
.context-ring-fill {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  pointer-events: none;
}

.context-ring-track {
  stroke: var(--border-color);
}

.context-ring-fill {
  stroke: var(--success);
  transition: stroke-dasharray 0.2s ease, stroke 0.2s ease;
}

.context-ring.warn .context-ring-fill {
  stroke: var(--warning);
}

.context-ring.danger .context-ring-fill {
  stroke: var(--danger);
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
  margin: 4px 14px 14px;
  padding: 10px 12px 8px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border-color));
}

.composer-actions {
  justify-content: space-between;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
