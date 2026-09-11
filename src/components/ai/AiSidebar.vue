<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiSettings, AiToolRun } from '../../env.d.ts'
import { useAiChat, type ChatItem } from '../../composables/ai/useAiChat'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  buildAiTerminalConfirmCopy,
  normalizeTerminalText,
} from '@/utils/terminal/terminalPaste'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { splitToolReason } from '@/utils/ai/toolReason'
import AppIcon from '../icons/AppIcon.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AiComposerSelector from './AiComposerSelector.vue'
import type { AiToolPermissionMode } from '@shared/aiToolPolicy'
import AiChatView from './AiChatView.vue'
import { aiModelId, billedConversationTokens, formatTokenCount, lastBilledConversationUsage } from '@shared/aiContext'
import { flattenConversationForApi } from '@shared/aiMessages'
import { estimateSidebarAiRequest } from '@shared/aiSidebarPrompt'
import { formatToolRunArgs, formatToolRunDisplay } from '@shared/aiToolRunDisplay'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import { diffPreviewRows } from '@/utils/ai/diffPreviewRows'
import { threadTitleTooltip } from '@/utils/ai/threadTitle'
import { sftpListedCwdState } from '@/utils/sftp/sftpListedCwd'

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
  refreshSettings,
  replaceSettings,
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
  editUserMessageAndResend,
  deleteMessage,
  resolveToolApproval,
} = useAiChat()

const messages = ref<ChatItem[]>([])
const input = ref('')
const loading = ref(false)
watch(() => getSessionState(props.sessionId).loading, value => { loading.value = value })
const showSettings = ref(false)
const showHistory = ref(false)
const showModelSwitcher = ref(false)
const threadSummaries = ref(getSessionState(props.sessionId).threads)
const consumedSelectionIds = new Set<number>()
const settingsPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)
const modelSwitcherButtonRef = ref<HTMLButtonElement | null>(null)
const modelSwitcherDropdownRef = ref<HTMLElement | null>(null)
const modelSwitcherStyle = ref<Record<string, string>>({})
const sidebarRef = ref<HTMLElement | null>(null)
const composerInputRef = ref<HTMLTextAreaElement | null>(null)
let composerObserver: ResizeObserver | undefined
function resizeComposer() {
  const el = composerInputRef.value
  const panel = sidebarRef.value
  if (!el || !panel || !el.getClientRects().length) return
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.5
  const form = el.closest('form')!
  const formStyle = getComputedStyle(form)
  const toolbarHeight = form.querySelector('.composer-actions')?.getBoundingClientRect().height || 30
  const statusHeight = panel.querySelector('.composer-context-warning')?.getBoundingClientRect().height || 0
  const chromeHeight = statusHeight + 4 + toolbarHeight + parseFloat(formStyle.paddingTop) + parseFloat(formStyle.paddingBottom) + parseFloat(formStyle.rowGap) + 2
  const maxHeight = Math.max(lineHeight * 2, Math.min(lineHeight * 8, panel.clientHeight * 0.3 - chromeHeight))
  el.style.height = '0px'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, lineHeight * 2), maxHeight)}px`
}
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.shiftKey) return
  event.preventDefault()
  void sendMessage()
}
const composerModelLabel = computed(() => activeProvider.value?.models.find(m => m.id === displayModelName.value)?.displayName || displayModelName.value)
const permissionLabel = computed(() => t(`ai.permissionShort${settings.value.toolPermission === 'auto' ? 'Auto' : settings.value.toolPermission === 'readonly' ? 'Readonly' : 'Ask'}`))
const savingComposer = ref(false)
const permissionOptions = computed(() => ['ask', 'auto', 'readonly'].map(value => ({ value, label: t(`ai.permission_${value}`), description: t(`ai.permissionDesc_${value}`) })))
async function savePermission(value: string) {
  if (loading.value || savingComposer.value) return
  savingComposer.value = true
  try {
    // Read the latest shared settings so another SSH panel's changes are preserved.
    const next = await window.LiteConnect.getAiSettings()
    next.toolPermission = value as AiToolPermissionMode
    await window.LiteConnect.setAiSettings(next)
    replaceSettings(await window.LiteConnect.getAiSettings())
  } catch (err: any) { ElMessage.warning(err?.message || t('ai.saveSettingsFailed')) }
  finally { savingComposer.value = false }
}
watch([input, showSettings, showHistory], () => { void nextTick(resizeComposer) })
const historyQuery = ref('')
const filteredHistoryItems = computed(() => {
  const query = historyQuery.value.trim().toLocaleLowerCase()
  return historyItems.value.filter(item => item.title.toLocaleLowerCase().includes(query))
})

const hasApiConfigured = computed(() => {
  const list = settings.value.providers || []
  return list.some((p) => (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0)
})

let initialLoadPromise: Promise<void> | null = null
const canSend = computed(() => input.value.trim().length > 0 && !loading.value && !savingComposer.value)

/** Tool calls awaiting user approval — confirmed from the bar above the composer. */
const pendingApprovals = computed(() => {
  const runs: AiToolRun[] = []
  for (const message of messages.value) {
    if (!message.streaming) continue
    for (const run of message.toolRuns || []) {
      if (run.status === 'ask') runs.push(run)
    }
  }
  return runs
})

function approvalHint(run: AiToolRun): string {
  return formatToolRunArgs(run.args) || formatToolRunDisplay(run).hint
}

function approvalRiskLabel(risk?: AiToolRun['risk']): string {
  if (risk === 'read') return t('ai.toolRiskRead')
  if (risk === 'write' || risk === 'destructive') return t('ai.toolRiskWrite')
  if (risk === 'privileged') return t('ai.toolRiskPrivileged')
  if (risk === 'forbidden') return t('ai.toolRiskForbidden')
  return ''
}

function approvalCopy(run: AiToolRun): string {
  if (run.risk === 'destructive' || run.risk === 'privileged' || run.risk === 'forbidden') {
    return t('ai.toolAskDanger')
  }
  return t('ai.toolAskHint')
}

const toolNameLabel = useAiToolNameLabel()

const currentThreadTitle = computed(() => {
  const active = threadSummaries.value.find((t) => t.active)
  const title = (active?.title || '').trim()
  return title || t('ai.newConversationTitle')
})

/** Titles are the raw first user message; the tooltip carries all of it. */
const currentThreadTitleTip = computed(() => threadTitleTooltip(currentThreadTitle.value))

const contextDroppedCount = computed(() => {
  if (loading.value || messages.value.some((m) => m.streaming)) return 0
  const conv = flattenConversationForApi(messages.value)
  if (!conv.length) return 0
  return estimateSidebarAiRequest({
    systemPrompt: settings.value.systemPrompt,
    messages: conv,
    sessionId: props.sessionId,
    cwd: sftpListedCwdState()[props.sessionId],
    model: settings.value.activeModel || displayModelName.value,
    contextWindowTokens: activeContextWindowTokens.value,
  }).droppedCount
})

const contextUsedTokens = computed(() =>
  billedConversationTokens(lastBilledConversationUsage(messages.value)),
)

const contextBudgetTokens = computed(() => activeContextWindowTokens.value)

const contextRatio = computed(() => {
  const budget = contextBudgetTokens.value
  if (budget <= 0) return 0
  return Math.min(1, Math.max(0, contextUsedTokens.value / budget))
})

const contextTone = computed<'ok' | 'warn' | 'danger'>(() => {
  if (contextRatio.value >= 0.95) return 'danger'
  if (contextRatio.value >= 0.8) return 'warn'
  return 'ok'
})

/** Last billed turn vs the model window. Composer draft is not counted. */
const showContextMeter = computed(() => contextRatio.value >= 0.7)

const contextMeterTitle = computed(() =>
  t('ai.contextUsage', {
    used: formatTokenCount(contextUsedTokens.value),
    budget: formatTokenCount(contextBudgetTokens.value),
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
      /** Hover shows the untouched first user message. */
      tip: threadTitleTooltip(thread.title),
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
          label: m.displayName || id,
          active: p.id === settings.value.activeProviderId && id === settings.value.activeModel,
        }
      }).filter((item) => item.model),
    }))
    .filter((g) => g.models.length > 0)
})

function syncMessages(msgs: ChatItem[]) {
  if (messages.value !== msgs) messages.value = msgs
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
  composerObserver = new ResizeObserver(resizeComposer)
  if (sidebarRef.value) composerObserver.observe(sidebarRef.value)
  syncFromState()
  void nextTick(resizeComposer)
  ensureInitialLoad().catch(() => {})
  document.addEventListener('keydown', closePopoverOnEscape)
})

onActivated(() => {
  void nextTick(resizeComposer)
  void refreshSettings().catch(() => {})
})

onBeforeUnmount(() => {
  composerObserver?.disconnect()
  saveSessionInput(props.sessionId, input.value)
  document.removeEventListener('keydown', closePopoverOnEscape)
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
        await refreshSettings()
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

async function handleEditResend(messageId: string, newText: string) {
  await editUserMessageAndResend(props.sessionId, messageId, newText, syncMessages)
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
  replaceSettings(next)
}

async function switchModel(providerId: string, model: string) {
  showModelSwitcher.value = false
  if (!model || loading.value || savingComposer.value) return
  try {
    const updated = await window.LiteConnect.switchAiModel(providerId, model)
    replaceSettings(updated)
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
  if (!content || savingComposer.value) return false
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
  await openSettingsPanel()
}

async function openSettingsPanel() {
  showHistory.value = false
  showModelSwitcher.value = false
  try {
    await refreshSettings()
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.loadSettingsFailed'))
  }
  showSettings.value = true
  await nextTick()
  settingsPanelRef.value?.applyExternal(settings.value)
}

function closeSettingsPanel() {
  showSettings.value = false
}

async function openHistoryPanel() {
  historyQuery.value = ''
  showModelSwitcher.value = false
  showHistory.value = true
  showSettings.value = false
  await nextTick()
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

</script>

<template>
  <div ref="sidebarRef" class="ai-sidebar">
    <div v-show="!showSettings && !showHistory" class="ai-header">
      <div class="ai-header-title-area">
        <div class="ai-title" :title="currentThreadTitleTip">{{ currentThreadTitle }}</div>
      </div>
      <div class="ai-header-actions">
        <details class="header-more">
          <summary :aria-label="t('ai.moreActions')" :title="t('ai.moreActions')">⋯</summary>
          <button type="button" class="ui-btn ui-btn-sm" @click="clearCurrentHistory">{{ t('ai.clearChat') }}</button>
        </details>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          :disabled="loading"
          :title="t('ai.newConversation')"
          @click="handleNewConversation"
        >
          <AppIcon name="plus" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showHistory }" @click="openHistoryPanel" :title="t('ai.history')">
          <AppIcon name="history" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showSettings }" @click="openSettingsPanel" :title="t('ai.settings')">
          <AppIcon name="settings" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('ai.closePanel')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div v-show="!showSettings && !showHistory" class="ai-body">
      <AiChatView
        :messages="messages"
        :has-api-configured="hasApiConfigured"
        :loading="loading"
        :context-dropped-count="contextDroppedCount"
        @open-settings="openSettingsCta"
        @fill-code="fillCodeToTerminal"
        @run-code="runCodeToTerminal"
        @regenerate="handleRegenerate"
        @retry="handleRetry"
        @edit-resend="handleEditResend"
        @delete-message="handleDeleteMessage"
        @use-example="(text) => { input = text }"
      />
    </div>

    <div v-if="pendingApprovals.length && !showSettings && !showHistory" class="tool-approval-stack">
      <div
        v-for="run in pendingApprovals"
        :key="run.id"
        class="tool-approval"
        :class="{ danger: run.risk === 'destructive' || run.risk === 'privileged' || run.risk === 'forbidden' }"
      >
        <div class="tool-approval-head">
          <span class="tool-approval-name">{{ toolNameLabel(run.name) }}</span>
          <span v-if="approvalRiskLabel(run.risk)" class="tool-approval-risk" :data-risk="run.risk">{{ approvalRiskLabel(run.risk) }}</span>
          <span class="tool-approval-copy">{{ approvalCopy(run) }}</span>
        </div>
        <p v-if="splitToolReason(run.reason).explanation" class="tool-approval-reason"><strong>{{ t('ai.toolExplanationLabel') }}</strong>{{ splitToolReason(run.reason).explanation }}</p>
        <p v-if="splitToolReason(run.reason).notice" class="tool-approval-reason tool-policy-notice"><strong>{{ t('ai.toolPolicyNoticeLabel') }}</strong>{{ splitToolReason(run.reason).notice }}</p>
        <pre v-if="approvalHint(run)" class="tool-approval-hint" :title="approvalHint(run)">{{ approvalHint(run) }}</pre>
        <div v-if="run.diffSummary || run.diffPreview" class="tool-approval-diff">
          <div v-if="run.diffSummary" class="tool-approval-diff-summary">{{ run.diffSummary }}</div>
          <pre v-if="run.diffPreview" class="tool-approval-diff-body"><span
            v-for="(row, i) in diffPreviewRows(run.diffPreview)"
            :key="i"
            class="diff-row"
            :class="`diff-${row.kind}`"
          >{{ row.text }}</span></pre>
        </div>
        <div class="tool-approval-actions">
          <button type="button" class="tool-approval-btn" @click="resolveToolApproval(props.sessionId, run.id, false)">{{ t('ai.toolDeny') }}</button>
          <button
            type="button"
            class="tool-approval-btn primary"
            @click="resolveToolApproval(props.sessionId, run.id, true)"
          >
            {{ t('ai.toolAllow') }}
          </button>
        </div>
      </div>
    </div>

    <div v-show="!showSettings && !showHistory" class="composer-area">
    <form class="composer" @submit.prevent="sendMessage">
      <textarea
        ref="composerInputRef"
        v-model="input"
        class="composer-input"
        :aria-label="t('ai.inputPlaceholder')"
        rows="2"
        :placeholder="t('ai.inputPlaceholder')"
        :title="t('ai.inputHint')"
        @keydown="onComposerKeydown"
      />
      <div class="composer-actions">
        <div class="composer-actions-right">
          <div class="model-switcher-wrap">
            <button
              v-if="displayModelName"
              ref="modelSwitcherButtonRef"
              type="button"
              class="ai-model-switcher"
              :disabled="loading || savingComposer"
              :aria-expanded="showModelSwitcher"
              aria-haspopup="menu"
              :class="{ active: showModelSwitcher }"
              @click="showModelSwitcher = !showModelSwitcher"
              :title="activeProvider ? `${activeProvider.name} · ${displayModelName}` : displayModelName"
            >
              <span class="ai-model-switcher-name">{{ composerModelLabel }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </button>
          </div>
          <div class="composer-permission-selector"><AiComposerSelector icon="shield" :title="t('ai.permissionTitle')" :label="permissionLabel" :short-label="t(`ai.permissionCompact_${settings.toolPermission || 'ask'}`)" :value="settings.toolPermission || 'ask'" :options="permissionOptions" :disabled="loading || savingComposer" @change="savePermission($event)" /></div>
          <button
            v-if="loading"
            type="button"
            class="stop-btn"
            :title="t('ai.stopGenerate')"
            @click="handleStop"
          >
            {{ t('common.stop') }}
          </button>
          <button v-else type="submit" class="send-btn" :aria-label="t('ai.sendMessage')" :disabled="!canSend">
            <AppIcon name="send" size="sm" />
          </button>
        </div>
      </div>
      <span v-if="showContextMeter" class="composer-context-warning" :class="contextTone" :title="contextMeterTitle" role="status">{{ t('ai.contextPercent', { n: Math.round(contextRatio * 100) }) }}</span>
    </form>
    </div>

    <Teleport to="body">
      <div
        v-if="showModelSwitcher && modelSwitcherGroups.length > 0"
        ref="modelSwitcherDropdownRef"
        class="model-switcher-dropdown"
        :style="modelSwitcherStyle"
      >
        <div class="model-context-info">{{ contextMeterTitle }} · {{ Math.round(contextRatio * 100) }}%</div>
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
            <span class="model-option-label">{{ item.label }}<small v-if="item.label !== item.model">{{ item.model }}</small></span>
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

    <div
      v-if="showSettings"
      class="ai-page ai-settings-page"
      role="region"
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
      class="ai-page ai-history-page"
      role="region"
      :aria-label="t('ai.history')"
    >
      <div class="ai-layer-header">
        <div class="ai-layer-heading">
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :aria-label="t('common.back')" @click="closeHistoryPanel"><AppIcon name="chevron-left" size="sm" /></button>
          <span class="ai-layer-title">{{ t('ai.history') }}</span>
          <span class="ai-layer-subtitle">{{ historyItems.length || '' }}</span>
        </div>
        <div class="ai-layer-actions">
          <button
            type="button"
            class="ui-btn ui-btn-xs ui-btn-ghost"
            v-if="historyItems.length > 0"
            @click="handleClearAllHistory"
          >
            <AppIcon name="delete" size="sm" />
            {{ t('ai.clearAllHistory') }}
          </button>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.closeHistory')" @click="closeHistoryPanel">
            <AppIcon name="close" size="sm" />
          </button>
        </div>
      </div>
      <label v-if="historyItems.length" class="ai-history-search"><AppIcon name="search" size="sm" /><input v-model="historyQuery" :placeholder="t('ai.searchHistory')" :aria-label="t('ai.searchHistory')" /></label>
      <div v-if="!filteredHistoryItems.length" class="ai-history-empty"><AppIcon name="history" size="2xl" /><span>{{ t(historyItems.length ? 'ai.noMatchingHistory' : 'ai.emptyHistory') }}</span></div>
      <div v-else class="ai-history-list">
        <div
          v-for="item in filteredHistoryItems"
          :key="item.id"
          class="ai-history-item"
          :class="{ active: item.active }"
        >
          <button
            type="button"
            class="ai-history-item-main"
            :title="item.tip || item.title"
            @click="handleSwitchConversation(item.id)"
          >
            <span class="ai-history-item-title">{{ item.title }}</span>
            <span v-if="item.active" class="ai-history-current"><AppIcon name="check" size="xs" />{{ t('common.current') }}</span>
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
  </div>
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

.ai-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}
.ai-settings-page :deep(.settings-box) {
  flex: 1;
  min-height: 0;
}
.ai-history-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 16px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
}
.ai-history-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
}
.ai-history-search:focus-within {
  border-color: var(--accent);
}
.ai-layer-header {
  min-height: 48px;
  padding: 10px 16px;
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
  flex: 1;
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

.ai-history-item:hover .ai-history-item-delete,
.ai-history-item:focus-within .ai-history-item-delete {
  opacity: 1;
}

.ai-history-item-delete:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.ai-history-item-title {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  line-height: 1.5;
  font-size: 12px;
  font-weight: 600;
}

.ai-history-current {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
  font-size: 11px;
}

.ai-history-item-meta {
  color: var(--text-secondary);
  font-size: 10px;
}

.ai-history-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
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
  max-width: 100%;
  min-width: 0;
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
  flex: 1;
  min-width: 0;
  flex-wrap: nowrap;
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
  min-height: 0;
  overflow-y: auto;
  flex-shrink: 0;
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
  flex-shrink: 0;
  margin: 0;
  padding: 10px 12px 8px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-approval-stack {
  margin: 0 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-approval {
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border-color));
  border-radius: 10px;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}

.tool-approval.danger {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border-color));
}

.tool-approval-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-approval-name {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--text-primary);
}

.tool-approval-risk {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  padding: 0 4px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
}

.tool-approval-risk[data-risk='destructive'],
.tool-approval-risk[data-risk='privileged'],
.tool-approval-risk[data-risk='forbidden'] {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.tool-approval-copy {
  color: var(--text-secondary);
}

.tool-approval-hint {
  margin: 0;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 72px;
  overflow: auto;
}

.tool-approval-diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tool-approval-diff-summary {
  color: var(--text-secondary);
  font-size: 10px;
}

.tool-approval-diff-body {
  margin: 0;
  padding: 5px 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  max-height: 180px;
  overflow: auto;
}

.tool-approval-diff-body .diff-row {
  display: block;
  width: max-content;
  min-width: 100%;
  padding: 0 8px;
  white-space: pre;
  color: var(--text-primary);
}

.tool-approval-diff-body .diff-head,
.tool-approval-diff-body .diff-hunk {
  color: var(--text-secondary);
}

.tool-approval-diff-body .diff-add {
  background: color-mix(in srgb, var(--success) 16%, transparent);
  color: var(--success);
}

.tool-approval-diff-body .diff-del {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.tool-approval-reason {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.4;
}

.tool-approval-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.tool-approval-btn {
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 11px;
  padding: 3px 12px;
  cursor: pointer;
}

.tool-approval-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.tool-approval-btn.primary {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border-color));
}

.tool-approval-btn.primary:hover:not(:disabled) {
  background: var(--accent-bg);
}

.tool-approval-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
.composer-permission { border: 0; background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; padding: 4px; }
.model-option-label { overflow-wrap: anywhere; min-width: 0; }
.model-option-label small { display: block; color: var(--text-secondary); font-size: 10px; margin-top: 3px; }
.header-more { position: relative; }
.header-more summary { cursor: pointer; list-style: none; padding: 4px 6px; color: var(--text-secondary); }
.header-more > button { position: absolute; top: 100%; right: 0; z-index: 10; white-space: nowrap; background: var(--bg-primary); }
.composer-area { flex-shrink: 0; margin: 4px 14px 12px; container-type: inline-size; container-name: ai-composer; min-width: 0; }
.composer-permission:hover { color: var(--text-primary); }
.send-btn, .stop-btn { flex-shrink: 0; }
.composer { padding: 10px; gap: 8px; }
.composer-actions-right { width: 100%; gap: 6px; min-width: 0; }
.composer-permission-selector { display: flex; margin-left: auto; flex-shrink: 0; }
.model-switcher-wrap { flex: 0 1 auto; min-width: 0; max-width: 220px; }
.ai-model-switcher { height: 34px; min-height: 34px; width: auto; gap: 8px; font-family: inherit; font-size: 11px; padding: 0 7px; justify-content: space-between; }
.ai-model-switcher:disabled { cursor: not-allowed; opacity: .5; }
.send-btn, .stop-btn { width: 38px; height: 38px; min-width: 38px; padding: 0; font-size: 11px; margin-left: 0; }
.composer-context-warning { font-size: 10px; color: var(--text-secondary); text-align: right; }
.composer-context-warning.warn { color: var(--warning); }
.composer-context-warning.danger { color: var(--danger); font-weight: 600; }
.model-context-info { padding: 6px; font-size: 11px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); }
@container ai-composer (max-width: 220px) {
  .composer-actions-right { display: grid; grid-template-columns: minmax(0, 1fr) 38px; column-gap: 12px; row-gap: 3px; }
  .model-switcher-wrap { grid-column: 1; }
  .send-btn, .stop-btn { grid-column: 2; grid-row: 1 / 3; margin-left: 0; }
}
.tool-policy-notice { color: var(--warning); }
.tool-policy-notice strong { font-weight: 600; }
</style>
