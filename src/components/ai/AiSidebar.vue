<script setup lang="ts">
import { useAiNewConversation } from '@/composables/ai/useAiNewConversation'
import { useAiClearConversation } from '@/composables/ai/useAiClearConversation'
import { useAiSidebarSession } from '@/composables/ai/useAiSidebarSession'
import { useAiMessageActions } from '@/composables/ai/useAiMessageActions'
import { useAiSidebarModelMenu } from '@/composables/ai/useAiSidebarModelMenu'
import { useAiSidebarContextFiles } from '@/composables/ai/useAiSidebarContextFiles'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiToolRun } from '../../env.d.ts'
import { useAiChat } from '../../composables/ai/useAiChat'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  buildAiTerminalConfirmCopy,
  normalizeTerminalText,
} from '@/utils/terminal/terminalPaste'
import AppIcon from '../icons/AppIcon.vue'
import AiImageStrip from './AiImageStrip.vue'
import AiToolApprovals from './AiToolApprovals.vue'
import AiConversationMenu, { type AiConversationMenuItem } from './AiConversationMenu.vue'
import AiBackgroundTasks from './AiBackgroundTasks.vue'
import AiFileTransfers from './AiFileTransfers.vue'
import AiUserQuestion from './AiUserQuestion.vue'
import { useAiComposerImages } from '@/composables/ai/useAiComposerImages'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AiComposerSelector from './AiComposerSelector.vue'
import AiContextMeter from './AiContextMeter.vue'
import type { AiToolPermissionMode } from '@shared/aiToolPolicy'
import AiChatView from './AiChatView.vue'
import { formatTokenCount, modelContextSource } from '@shared/aiContext'
import { aiToolSchemaTokens } from '@shared/aiContextPressure'
import { aiToolGroupsFromHistory, normalizeAiToolGroups } from '@shared/aiToolCatalog'
import { flattenConversationForApi } from '@shared/aiMessages'
import { projectAiHistoryForContext, AI_COMPACTION_NEW_THREAD_AT } from '@shared/aiCompaction'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import { workspaceToolsForChat, workspaceToolSystemAddendum } from '@shared/aiWorkspacePrompt'
import { estimateSidebarAiRequest, sidebarContextFilesFit } from '@shared/aiSidebarPrompt'
import { useAiSidebarHistory } from '@/composables/ai/useAiSidebarHistory'
import { threadTitleTooltip } from '@/utils/ai/threadTitle'
import { sftpListedCwdState } from '@/utils/sftp/sftpListedCwd'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  sessionId: string
  workspace?: boolean
  disconnectAvailable?: boolean
  connectionBusy?: boolean
  workspaceTargets?: AiWorkspaceTarget[]
  executionAvailable?: boolean
  active?: boolean
  /** Increments only when a previously closed AI panel opens for this SSH session. */
  openGeneration?: number
  selectionRequest?: {
    id: number
    sessionId: string
    text: string
    mode: 'send' | 'insert'
  } | null
}>(), { active: true, openGeneration: 0, executionAvailable: true })

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'selectionConsumed', id: number): void
  (e: 'request-other-host-chat'): void
  (e: 'disconnect-ssh'): void
  (e: 'conversation-cleared'): void
}>()

const chat = useAiChat()
const {
  settings,
  refreshSettings,
  replaceSettings,
  activeProvider,
  displayModelName,
  activeContextWindowTokens,
  compactContext,
  getSessionState,
  startNewConversation,
  setConversationContextFile,
  removeConversationContextFile,
  updateConversation,
  switchConversation,
  deleteConversation,
  clearAllConversations,
  clearMessages,
  regenerateMessage,
  retryMessage,
  editUserMessageAndResend,
  deleteMessage,
  answerQuestion,
  getQuestionDraft,
} = chat

const contextFiles = computed(() => getSessionState(props.sessionId).contextFiles)
const compactionCount = computed(() => getSessionState(props.sessionId).compactionCount)
const reminderKey = computed(() => `${props.sessionId}:${getSessionState(props.sessionId).activeThreadId}`)
const dismissedCompactionCounts = reactive<Record<string, number>>({})
const showLongSessionReminder = computed(() => messages.value.length > 0 && compactionCount.value >= AI_COMPACTION_NEW_THREAD_AT && compactionCount.value > (dismissedCompactionCounts[reminderKey.value] || 0))
function continueLongSession() { dismissedCompactionCounts[reminderKey.value] = compactionCount.value }
const supportsImages = computed(() => activeProvider.value?.models.find(model => model.id === displayModelName.value)?.supportsImages === true)
const settingsPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)
const sidebarRef = ref<HTMLElement | null>(null)
const chatViewRef = ref<InstanceType<typeof AiChatView> | null>(null)
const composerAreaRef = ref<HTMLElement | null>(null)
const composerInputRef = ref<HTMLTextAreaElement | null>(null)
const modelMenuId = useId()
const { messages, input, loading, threadSummaries, syncMessages, syncFromState,
  ensureInitialLoad, sendMessage, handleStop, onSettingsSaved,
} = useAiSidebarSession({
  chat, sessionId: () => props.sessionId, active: () => props.active,
  openGeneration: () => props.openGeneration, selectionRequest: () => props.selectionRequest,
  selectionConsumed: id => emit('selectionConsumed', id), canSend: () => canSend.value,
  sendBlocked: () => savingComposer.value || newConversationBusy.value || clearingConversation.value || contextFilesTooLong.value || !props.executionAvailable,
  canCompact: () => !loading.value && !savingComposer.value && !contextFileBusy.value && !newConversationBusy.value && !clearingConversation.value && props.executionAvailable,
  compact: handleCompactContext, applySettings: () => settingsPanelRef.value?.applyExternal(settings.value),
  t: key => t(key),
})

let composerObserver: ResizeObserver | undefined
let composerLayoutRaf = 0
let composerOverlayInset = 0
let documentKeydownActive = false
let sidebarDisposed = false

function attachSidebarDomListeners() {
  if (!documentKeydownActive) {
    document.addEventListener('keydown', closePopoverOnEscape)
    document.addEventListener('pointerdown', closeContextFileMenuOnOutsideClick)
    documentKeydownActive = true
  }
  if (sidebarRef.value) composerObserver?.observe(sidebarRef.value)
  const body = sidebarRef.value?.querySelector('.ai-body')
  if (body) composerObserver?.observe(body)
  if (composerAreaRef.value) composerObserver?.observe(composerAreaRef.value)
}

function detachSidebarDomListeners() {
  composerObserver?.disconnect()
  if (documentKeydownActive) {
    document.removeEventListener('keydown', closePopoverOnEscape)
    document.removeEventListener('pointerdown', closeContextFileMenuOnOutsideClick)
    documentKeydownActive = false
  }
}
function resizeComposer() {
  const el = composerInputRef.value
  const panel = sidebarRef.value
  if (!panel) return
  if (!el || !el.getClientRects().length) { updateComposerOverlayInset(); return }
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.5
  const form = el.closest('form')!
  const formStyle = getComputedStyle(form)
  const toolbarHeight = form.querySelector('.composer-actions')?.getBoundingClientRect().height || 30
  const statusHeight = panel.querySelector('.composer-context-warning')?.getBoundingClientRect().height || 0
  const filesHeight = form.querySelector('.composer-context-files')?.getBoundingClientRect().height || 0
  const imagesHeight = form.querySelector('.composer-images')?.getBoundingClientRect().height || 0
  const reminderHeight = form.querySelector('.composer-long-session')?.getBoundingClientRect().height || 0
  const chromeHeight = statusHeight + filesHeight + imagesHeight + reminderHeight + 4 + toolbarHeight + parseFloat(formStyle.paddingTop) + parseFloat(formStyle.paddingBottom) + parseFloat(formStyle.rowGap) + 2
  const maxHeight = Math.max(lineHeight * 2, Math.min(lineHeight * 8, panel.clientHeight * 0.3 - chromeHeight))
  el.style.height = '0px'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, lineHeight * 2), maxHeight)}px`
  if (composerLayoutRaf) cancelAnimationFrame(composerLayoutRaf)
  composerLayoutRaf = requestAnimationFrame(() => {
    composerLayoutRaf = 0
    updateComposerOverlayInset()
  })
}

function updateComposerOverlayInset() {
  const panel = sidebarRef.value
  const area = composerAreaRef.value
  if (!panel || !area || !area.getClientRects().length) return
  const body = panel.querySelector('.ai-body')
  if (body?.getClientRects().length) {
    // The workspace toolbar can wrap onto two rows. Bound questions by the
    // actual chat viewport rather than a fixed header-height assumption.
    const available = panel.getBoundingClientRect().bottom - body.getBoundingClientRect().top - (parseFloat(getComputedStyle(area).bottom) || 0) - 8
    panel.style.setProperty('--ai-question-max-height', `${Math.max(0, Math.floor(available))}px`)
  }
  // Composer floats over the full-height chat scroller. Reserve its measured
  // height plus the visual bottom/gap so the latest message remains visible.
  const inset = Math.ceil(area.getBoundingClientRect().height + 20)
  if (inset === composerOverlayInset) return
  composerOverlayInset = inset
  panel.style.setProperty('--ai-composer-overlay-inset', `${inset}px`)
  chatViewRef.value?.handleViewportInsetChange()
}
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.shiftKey) return
  event.preventDefault()
  void sendMessage()
}
const composerModelLabel = computed(() => activeProvider.value?.models.find(m => m.id === displayModelName.value)?.displayName || displayModelName.value)
const permissionLabel = computed(() => t(`ai.permissionShort${settings.value.toolPermission === 'auto' ? 'Auto' : settings.value.toolPermission === 'readonly' ? 'Readonly' : 'Ask'}`))
const savingComposer = ref(false)

const {
  contextFileBusy, contextFileMenuRef, contextFilePreviewKey, previewContextFile,
  contextFileName, contextFileKey, contextFileSourceStatus, contextFileTitle, contextFileChipLabel,
  onContextFileMenuToggle, toggleContextFilePreview, chooseLocalContextFile, chooseSshContextFile,
  removeContextFile, refreshContextFile,
} = useAiSidebarContextFiles({
  sessionId: () => props.sessionId, threadId: () => getSessionState(props.sessionId).activeThreadId,
  loading: () => loading.value, active: () => props.active, openGeneration: () => props.openGeneration,
  files: contextFiles, ensureLoaded: () => ensureInitialLoad(false),
  setFile: setConversationContextFile, removeFile: removeConversationContextFile,
  t: (key, params) => t(key, params ?? {}),
})
const {
  showSettings, showModelSwitcher, modelSwitcherButtonRef, modelSwitcherDropdownRef,
  modelSwitcherStyle, modelSwitcherGroups, switchModel, openSettingsPanel, closeSettingsPanel,
  openModelSwitcher, closeModelSwitcher, toggleModelSwitcher, onModelMenuKeydown,
} = useAiSidebarModelMenu({
  settings, loading: () => loading.value, saving: () => savingComposer.value, active: () => props.active,
  refreshSettings, replaceSettings, applyExternal: next => settingsPanelRef.value?.applyExternal(next),
  closeHistory: () => closeHistoryPanel(), t: key => t(key),
})
const { handleRegenerate, handleRetry, handleEditResend, handleDeleteMessage } = useAiMessageActions({
  sessionId: () => props.sessionId, threadId: () => getSessionState(props.sessionId).activeThreadId,
  blocked: () => clearingConversation.value || contextFilesTooLong.value || !props.executionAvailable,
  loading, sessionLoading: id => getSessionState(id).loading, syncMessages,
  regenerate: regenerateMessage, retry: retryMessage, edit: editUserMessageAndResend, remove: deleteMessage,
  t: key => t(key),
})

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
const {
  showHistory, historyQuery, historyItems, filteredHistoryItems, historyBusy,
  openHistoryPanel, closeHistoryPanel, handleSwitchConversation,
  handleDeleteConversation, handleRenameConversation, handleTogglePin,
  handleClearAllHistory, formatHistoryTime,
} = useAiSidebarHistory({
  sessionId: () => props.sessionId,
  threadSummaries,
  activeThreadId: () => getSessionState(props.sessionId).activeThreadId,
  loading,
  contextFileBusy,
  syncMessages,
  syncFromState,
  switchConversation,
  deleteConversation,
  clearAllConversations,
  updateConversation,
  t: (key, params) => t(key, params ?? {}),
  closeModelSwitcher: () => { showModelSwitcher.value = false },
  closeSettings: closeSettingsPanel,
})
const {
  draftImages, imageInputRef, imageBusy, imageDragOver,
  onImageSelection, onImagePaste, onImageDragOver, onImageDrop, onImageDragLeave,
} = useAiComposerImages({
  sessionId: () => props.sessionId,
  draft: () => getSessionState(props.sessionId),
  loading: () => loading.value,
  supportsImages: () => supportsImages.value,
  blocked: () => showSettings.value || showHistory.value,
  containsTarget: target => target instanceof Node && !!sidebarRef.value?.contains(target),
  ensureLoaded: () => ensureInitialLoad(false),
  t: key => t(key),
})
watch([input, showSettings, showHistory, contextFiles, showLongSessionReminder, () => draftImages.value.length], () => { void nextTick(resizeComposer) })

const hasApiConfigured = computed(() => {
  const list = settings.value.providers || []
  return list.some((p) => (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0)
})

const toolGroups = computed(() => normalizeAiToolGroups([
  ...normalizeAiToolGroups(getSessionState(props.sessionId).toolGroups), ...aiToolGroupsFromHistory(messages.value),
]))
const toolContext = computed(() => props.workspaceTargets ? {
  system: workspaceToolSystemAddendum(props.workspaceTargets),
  schemaTokens: aiToolSchemaTokens(workspaceToolsForChat(toolGroups.value)),
} : undefined)
const workspaceJobIds = computed(() => props.workspaceTargets ? messages.value.flatMap(message => (message.toolRuns || []).flatMap(run => run.jobIds || [])) : undefined)
const workspaceJobTargets = computed(() => Object.fromEntries(messages.value.flatMap(message => (message.toolRuns || []).flatMap(run => (run.jobIds || []).map(id => [id, run.target || ''])))))
const targetSessionIds = computed(() => props.workspaceTargets?.map(target => target.sessionId).filter(Boolean) || [props.sessionId])
const { newConversationBusy, handleNewConversation } = useAiNewConversation({
  sessionId: () => props.sessionId, threadId: () => getSessionState(props.sessionId).activeThreadId,
  blocked: () => loading.value || clearingConversation.value || contextFileBusy.value || !!props.connectionBusy,
  sessionLoading: id => getSessionState(id).loading,
  targetSessionIds: () => targetSessionIds.value, jobIds: () => workspaceJobIds.value,
  start: startNewConversation, syncMessages, syncFromState,
  t: (key, params) => t(key, params ?? {}),
})
const { clearingConversation, handleClearConversation } = useAiClearConversation({
  sessionId: () => props.sessionId, threadId: () => getSessionState(props.sessionId).activeThreadId,
  blocked: () => loading.value || newConversationBusy.value || contextFileBusy.value || imageBusy.value || savingComposer.value || historyBusy.value || !!props.connectionBusy,
  hasMessages: () => messages.value.length > 0,
  targetSessionIds: () => targetSessionIds.value, jobIds: () => workspaceJobIds.value,
  clear: clearMessages, syncMessages,
  cleared: () => { syncFromState(); emit('conversation-cleared') }, t: key => t(key),
})
const contextFilesTooLong = computed(() => !sidebarContextFilesFit({
  ...activeProvider.value?.models.find(model => model.id === displayModelName.value),
  systemPrompt: settings.value.systemPrompt,
  toolContext: toolContext.value,
  toolGroups: toolGroups.value,
  sessionId: props.sessionId,
  cwd: sftpListedCwdState()[props.sessionId],
  model: settings.value.activeModel || displayModelName.value,
  contextWindowTokens: activeContextWindowTokens.value,
  contextFiles: contextFiles.value,
}))
const canSend = computed(() => props.executionAvailable && (input.value.trim().length > 0 || draftImages.value.length > 0) && (!draftImages.value.length || supportsImages.value) && !imageBusy.value && !loading.value && !savingComposer.value && !newConversationBusy.value && !clearingConversation.value && !contextFileBusy.value && !contextFilesTooLong.value)
watch(contextFilesTooLong, () => { void nextTick(resizeComposer) })

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
const pendingQuestions = computed(() => messages.value.filter(message => message.streaming).flatMap(message => (message.toolRuns || []).filter(run => run.status === 'question')))

watch(() => props.openGeneration, () => {
  if (!pendingApprovals.value.length && !pendingQuestions.value.length) return
  closeSettingsPanel()
  closeHistoryPanel()
  closeModelSwitcher()
})

const currentThreadTitle = computed(() => {
  const active = threadSummaries.value.find((t) => t.active)
  const title = (active?.title || '').trim()
  return title || t('ai.newConversationTitle')
})

/** Titles are the raw first user message; the tooltip carries all of it. */
const currentThreadTitleTip = computed(() => threadTitleTooltip(currentThreadTitle.value))

const contextDroppedCount = computed(() => {
  if (loading.value || messages.value.some((m) => m.streaming)) return 0
  const checkpoint = getSessionState(props.sessionId).contextCheckpoint
  const conv = checkpoint
    ? projectAiHistoryForContext(messages.value, checkpoint)
    : flattenConversationForApi(messages.value)
  if (!conv.length) return 0
  return estimateSidebarAiRequest({
    systemPrompt: settings.value.systemPrompt,
    messages: conv,
    toolContext: toolContext.value,
    toolGroups: toolGroups.value,
    sessionId: props.sessionId,
    cwd: sftpListedCwdState()[props.sessionId],
    model: settings.value.activeModel || displayModelName.value,
    contextWindowTokens: activeContextWindowTokens.value,
    contextFiles: contextFiles.value,
  }).droppedCount
})

const contextModelConfig = computed(() => activeProvider.value?.models.find(model => model.id === displayModelName.value))
const contextPressure = computed(() => {
  const state = getSessionState(props.sessionId)
  if (loading.value && state.contextPressure) return state.contextPressure
  const projected = projectAiHistoryForContext(messages.value, state.contextCheckpoint)
  if (input.value.trim() || draftImages.value.length) projected.push({ role: 'user', content: input.value, images: draftImages.value })
  return estimateSidebarAiRequest({
    ...contextModelConfig.value, model: displayModelName.value, contextWindowTokens: activeContextWindowTokens.value,
    systemPrompt: settings.value.systemPrompt, messages: projected, contextFiles: contextFiles.value,
    toolContext: toolContext.value, sessionId: props.sessionId, cwd: sftpListedCwdState()[props.sessionId],
    toolGroups: toolGroups.value,
  }).pressure
})
const contextUsedTokens = computed(() => contextPressure.value.usedTokens)
const contextBudgetTokens = computed(() => contextPressure.value.windowTokens)

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

/** Show the same next-request estimate the backend uses, including the draft. */
const showContextMeter = computed(() => props.workspace && contextRatio.value >= 0.7)

const contextMeterTitle = computed(() =>
  t('ai.contextUsage', {
    used: formatTokenCount(contextUsedTokens.value),
    budget: formatTokenCount(contextBudgetTokens.value),
  }),
)
const contextSourceLabel = computed(() => {
  const info = modelContextSource({
    ...contextModelConfig.value, id: displayModelName.value,
    contextWindowTokens: contextModelConfig.value?.contextWindowTokens ?? settings.value.contextWindowTokens,
  })
  return t(`ai.contextSource${info.source[0].toUpperCase()}${info.source.slice(1)}`, { tokens: info.tokens })
})

async function handleCompactContext() {
  if (loading.value || clearingConversation.value || savingComposer.value || contextFileBusy.value || newConversationBusy.value || !props.executionAvailable) return
  await compactContext(props.sessionId)
}

onMounted(() => {
  composerObserver = new ResizeObserver(resizeComposer)
  if (props.active) attachSidebarDomListeners()
  void nextTick(resizeComposer)
})

onActivated(() => {
  if (!props.active) return
  attachSidebarDomListeners()
  void nextTick(resizeComposer)
  void refreshSettings().catch(() => {})
})

onDeactivated(() => {
  showModelSwitcher.value = false
  detachSidebarDomListeners()
})

watch(
  () => props.active,
  (active) => {
    if (active) {
      attachSidebarDomListeners()
      void nextTick(resizeComposer)
      void refreshSettings().catch(() => {})
      return
    }
    showModelSwitcher.value = false
    detachSidebarDomListeners()
  },
)

onBeforeUnmount(() => {
  sidebarDisposed = true
  detachSidebarDomListeners()
  if (composerLayoutRaf) cancelAnimationFrame(composerLayoutRaf)
})

const conversationMenuItems = computed<AiConversationMenuItem[]>(() => [
  { id: 'new-current', icon: 'plus', label: t(props.workspaceTargets ? 'ai.workspace.newInScope' : 'ai.workspace.newOnCurrent'), disabled: loading.value || clearingConversation.value || newConversationBusy.value || props.connectionBusy },
  { id: 'new-scope', icon: 'server', label: t('ai.workspace.newScope'), disabled: loading.value || clearingConversation.value || newConversationBusy.value || props.connectionBusy },
  { id: 'history', icon: 'history', label: t('ai.history'), separator: true, disabled: clearingConversation.value },
  { id: 'settings', icon: 'settings', label: t('ai.settings'), disabled: clearingConversation.value },
  { id: 'disconnect', icon: 'unplug', label: t('ai.workspace.disconnectSsh'), danger: true, separator: true, disabled: clearingConversation.value || !props.disconnectAvailable || props.connectionBusy },
])
function selectConversationAction(action: string) {
  if (action === 'new-current') void handleNewConversation()
  else if (action === 'new-scope') requestOtherHostChat()
  else if (action === 'history') void openHistoryPanel()
  else if (action === 'settings') void openSettingsPanel()
  else if (action === 'disconnect' && props.disconnectAvailable && !props.connectionBusy) emit('disconnect-ssh')
}

function requestOtherHostChat() {
  emit('request-other-host-chat')
}

async function openSettingsCta() {
  await openSettingsPanel()
}

function closePopoverOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  showModelSwitcher.value = false
  contextFileMenuRef.value?.removeAttribute('open')
  contextFilePreviewKey.value = ''
  closeSettingsPanel()
  closeHistoryPanel()
}

function closeContextFileMenuOnOutsideClick(event: PointerEvent) {
  if (!contextFileMenuRef.value?.contains(event.target as Node)) {
    contextFileMenuRef.value?.removeAttribute('open')
  }
  if (!composerAreaRef.value?.querySelector('.composer-context-files')?.contains(event.target as Node)) {
    contextFilePreviewKey.value = ''
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
  const sessionId = props.sessionId
  const threadId = getSessionState(sessionId).activeThreadId
  const text = await confirmAiTerminalAction('fill', code)
  if (!text || sidebarDisposed || props.sessionId !== sessionId || getSessionState(sessionId).activeThreadId !== threadId) return
  try {
    window.LiteConnect.sshWrite(sessionId, text)
    ElMessage.success(t('ai.filledTerminal'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.fillFailed'))
  }
}

async function runCodeToTerminal(code: string) {
  const sessionId = props.sessionId
  const threadId = getSessionState(sessionId).activeThreadId
  const text = await confirmAiTerminalAction('run', code)
  if (!text || sidebarDisposed || props.sessionId !== sessionId || getSessionState(sessionId).activeThreadId !== threadId) return
  const payload = text.endsWith('\n') ? text : `${text}\n`
  try {
    window.LiteConnect.sshWrite(sessionId, payload)
    ElMessage.success(t('ai.sentTerminal'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.sendFailed'))
  }
}

</script>

<template>
  <div ref="sidebarRef" class="ai-sidebar" :class="{ 'is-workspace': workspace }" @dragover="onImageDragOver" @dragleave="onImageDragLeave" @drop="onImageDrop">
    <div v-show="!showSettings && !showHistory" class="ai-header">
      <slot name="header-leading" />
      <div class="ai-header-title-area">
        <div class="ai-title" :title="currentThreadTitleTip">{{ currentThreadTitle }}</div>
      </div>
      <div v-if="$slots['workspace-toolbar']" class="ai-header-context"><slot name="workspace-toolbar" /></div>
      <div class="ai-header-actions">
        <button v-if="workspace" type="button" class="ui-btn ui-btn-xs workspace-clear-chat"
          :disabled="!messages.length || loading || clearingConversation || newConversationBusy || contextFileBusy || imageBusy || savingComposer || historyBusy || connectionBusy"
          :title="t('ai.clearConversationTitle')" :aria-label="t('ai.clearConversationTitle')" :aria-busy="clearingConversation"
          @click="handleClearConversation"><AppIcon name="delete" size="sm" /><span>{{ t('ai.clear') }}</span></button>
        <AiConversationMenu v-if="workspace" :items="conversationMenuItems" :active="active" @select="selectConversationAction" />
        <button
          v-else
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          :disabled="loading || newConversationBusy"
          :title="t('ai.newConversationHint')"
          @click="handleNewConversation"
        >
          <AppIcon name="plus" size="sm" />
        </button>
        <button v-if="!workspace" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showHistory }" @click="openHistoryPanel" :title="t('ai.history')">
          <AppIcon name="history" size="sm" />
        </button>
        <button v-if="!workspace" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm header-settings-action" :class="{ active: showSettings }" @click="openSettingsPanel" :title="t('ai.settings')">
          <AppIcon name="settings" size="sm" />
        </button>
        <button v-if="!workspace" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('ai.closePanel')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
      <slot name="header-trailing" />
    </div>

    <AiBackgroundTasks v-show="!showSettings && !showHistory" :active="active && !showSettings && !showHistory" :layout="workspace ? 'workspace' : 'sidebar'" :session-id="sessionId" :targets="workspaceTargets" :job-ids="workspaceJobIds" :job-targets="workspaceJobTargets" />
    <AiFileTransfers v-show="!showSettings && !showHistory" :key="reminderKey" :session-id="sessionId" :thread-id="getSessionState(sessionId).activeThreadId" :targets="workspaceTargets" />
    <div v-show="!showSettings && !showHistory" class="ai-body">
      <AiChatView
        :conversation-key="reminderKey"
        :terminal-actions="!workspace"
        :workspace-host-count="workspaceTargets?.length"
        :workspace-targets="workspaceTargets"
        ref="chatViewRef"
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

    <AiToolApprovals v-if="!showSettings && !showHistory" :key="sessionId" :session-id="sessionId" :runs="pendingApprovals" />

    <div ref="composerAreaRef" v-show="!showSettings && !showHistory" class="composer-area" :class="{ 'has-question': pendingQuestions.length }">
    <AiUserQuestion v-for="run in pendingQuestions" :key="JSON.stringify([reminderKey, getSessionState(sessionId).activeRequestId, run.id, run.args])" :run="run" :draft="getQuestionDraft(sessionId, run)" :submit="answer => answerQuestion(sessionId, run.id, answer)" allow-stop @stop="handleStop" />
    <form v-show="!pendingQuestions.length" class="composer" :class="{ 'image-drag-over': imageDragOver }" @submit.prevent="sendMessage">
      <div v-if="showLongSessionReminder" class="composer-long-session" role="status">
        <p>{{ t('ai.longSessionReminder', { n: compactionCount }) }}</p>
        <div class="long-session-actions">
          <button type="button" class="ui-btn ui-btn-xs" :disabled="loading || contextFileBusy || imageBusy || newConversationBusy" @click="handleNewConversation">{{ t('ai.newConversationTitle') }}</button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="continueLongSession">{{ t('ai.continueCurrentConversation') }}</button>
        </div>
      </div>
      <input ref="imageInputRef" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="onImageSelection" />
      <div class="composer-context-files">
        <div class="composer-context-strip">
          <details ref="contextFileMenuRef" class="composer-context-menu" @toggle="onContextFileMenuToggle">
            <summary :aria-label="t('ai.contextFileAdd')" :title="`${t('ai.contextFileAdd')} · ${t('ai.contextFileCount', { count: contextFiles.length })}`">
              <AppIcon name="plus" size="sm" />
            </summary>
            <div class="composer-context-dropdown">
              <div class="composer-context-info">
                <div class="composer-context-info-title">{{ t('ai.contextFileHowItWorks') }}</div>
                <p>{{ t('ai.contextFileMenuHint') }}</p>
              </div>
              <div class="composer-context-add-actions">
                <div class="composer-context-actions-title">{{ t('ai.contextFileChooseSource') }}</div>
                <button type="button" :disabled="loading || contextFileBusy || contextFiles.length >= 5" @click="chooseLocalContextFile">{{ t('ai.contextFileLocal') }}</button>
                <button v-if="!workspaceTargets" type="button" :disabled="loading || contextFileBusy || contextFiles.length >= 5" @click="chooseSshContextFile">{{ t('ai.contextFileSsh') }}</button>
                <div v-if="contextFiles.length >= 5" class="composer-context-limit">{{ t('ai.contextFileLimit') }}</div>
              </div>
            </div>
          </details>
          <button type="button" class="ui-icon-btn composer-add-image" :disabled="loading || imageBusy || !supportsImages || draftImages.length >= 4" :title="supportsImages ? t('ai.addImageHint') : t('ai.imagesNotEnabled')" :aria-label="t('ai.addImage')" @click="imageInputRef?.click()"><AppIcon name="image" size="sm" /></button>
          <div v-if="contextFiles.length" class="composer-context-chips" role="list" :aria-label="t('ai.contextFileCount', { count: contextFiles.length })">
            <div v-for="file in contextFiles" :key="contextFileKey(file)" class="composer-context-chip" role="listitem" :class="{ missing: contextFileSourceStatus[contextFileKey(file)] === 'missing', previewing: contextFilePreviewKey === contextFileKey(file) }">
              <button type="button" class="composer-context-chip-main" :aria-expanded="contextFilePreviewKey === contextFileKey(file)" :aria-label="contextFileChipLabel(file)" :title="contextFileTitle(file)" @click="toggleContextFilePreview(file)">
                <AppIcon name="file-text" size="xs" />
                <span class="composer-context-chip-name">{{ contextFileName(file) }}</span>
                <span v-if="contextFileSourceStatus[contextFileKey(file)] === 'missing'" class="composer-context-chip-alert"><AppIcon name="alert-triangle" size="xs" /></span>
                <span v-else-if="contextFileSourceStatus[contextFileKey(file)] === 'unavailable'" class="composer-context-chip-alert is-unavailable"><AppIcon name="alert-circle" size="xs" /></span>
              </button>
              <button type="button" class="composer-context-chip-remove" :disabled="loading || contextFileBusy" :aria-label="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })" :title="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })" @click="removeContextFile(file)"><AppIcon name="close" size="xs" /></button>
            </div>
          </div>
        </div>
        <div v-if="previewContextFile" class="composer-context-preview">
          <div class="composer-context-preview-head">
            <span>{{ t('ai.contextFilePreviewCaption') }}</span>
            <span class="composer-context-preview-path" :title="previewContextFile.path">{{ previewContextFile.path }}</span>
            <button type="button" class="composer-context-refresh" :disabled="loading || contextFileBusy" @click="refreshContextFile(previewContextFile)"><AppIcon name="refresh" size="xs" />{{ t('ai.contextFileCheckUpdate') }}</button>
          </div>
          <pre>{{ previewContextFile.content }}</pre>
        </div>
      </div>
      <AiImageStrip v-if="draftImages.length" class="composer-images" :images="draftImages" removable :disabled="loading || imageBusy" @remove="draftImages.splice($event, 1)" />
      <span v-if="imageBusy" class="composer-context-warning" role="status">{{ t('ai.imageProcessing') }}</span>
      <span v-if="draftImages.length && !supportsImages" class="composer-context-warning danger" role="alert">{{ t('ai.imagesNotEnabled') }}</span>
      <textarea
        ref="composerInputRef"
        v-model="input"
        class="composer-input"
        :aria-label="t('ai.inputPlaceholder')"
        rows="2"
        :placeholder="t('ai.inputPlaceholder')"
        :title="t('ai.inputHint')"
        @keydown="onComposerKeydown"
        @paste="onImagePaste"
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
              :aria-controls="showModelSwitcher ? modelMenuId : undefined"
              @click="toggleModelSwitcher"
              @keydown.down.prevent="openModelSwitcher('first')"
              @keydown.up.prevent="openModelSwitcher('last')"
              @keydown.esc.stop.prevent="closeModelSwitcher(true)"
              :title="activeProvider ? `${activeProvider.name} · ${displayModelName}` : displayModelName"
            >
              <span class="ai-model-switcher-name">{{ composerModelLabel }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </button>
            <AiContextMeter
              v-if="workspace && displayModelName" :key="reminderKey"
              :pressure="contextPressure" :source-label="contextSourceLabel" :compaction-count="compactionCount"
              :can-compact="!loading && !savingComposer && !contextFileBusy && !newConversationBusy && !!messages.length && props.executionAvailable"
              @compact="handleCompactContext"
            />
          </div>
          <div class="composer-permission-selector"><AiComposerSelector icon="shield" :title="t('ai.permissionTitle')" :label="permissionLabel" :value="settings.toolPermission || 'ask'" :options="permissionOptions" :disabled="loading || savingComposer" @change="savePermission($event)" /></div>
          <button
            v-if="loading"
            type="button"
            class="stop-btn"
            :aria-label="t('ai.stopGenerate')"
            :title="t('ai.stopGenerate')"
            @click="handleStop"
          >
            <AppIcon name="stop" size="sm" />
          </button>
          <button v-else type="submit" class="send-btn" :aria-label="t('ai.sendMessage')" :disabled="!canSend">
            <AppIcon name="send" size="sm" />
          </button>
        </div>
      </div>
      <span v-if="contextFilesTooLong" class="composer-context-warning danger context-file-too-long" role="alert">{{ t('ai.contextFileTooLong') }}</span>
      <span v-else-if="showContextMeter" class="composer-context-warning" :class="contextTone" :title="contextMeterTitle" role="status">{{ t('ai.contextPercent', { n: Math.round(contextRatio * 100) }) }}</span>
    </form>
    </div>

    <Teleport to="body">
      <div
        v-if="showModelSwitcher && modelSwitcherGroups.length > 0"
        ref="modelSwitcherDropdownRef"
        class="model-switcher-dropdown"
        :id="modelMenuId"
        role="menu"
        :aria-label="t('ai.manageModels')"
        :style="modelSwitcherStyle"
        @keydown="onModelMenuKeydown"
      >
        <div v-if="workspace" class="model-context-info">{{ contextMeterTitle }} · {{ Math.round(contextRatio * 100) }}%</div>
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
            role="menuitemradio"
            :aria-checked="item.active"
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
        @click="closeModelSwitcher(true)"
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
        :layout="workspace ? 'page' : 'panel'"
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
            :disabled="historyBusy || loading || contextFileBusy"
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
      <div v-else class="ai-history-list" :aria-busy="historyBusy">
        <div
          v-for="item in filteredHistoryItems"
          :key="item.id"
          class="ai-history-item"
          :class="{ active: item.active }"
        >
          <button
            type="button"
            class="ai-history-item-main"
            :disabled="historyBusy || loading || contextFileBusy"
            :title="item.tip || item.title"
            @click="handleSwitchConversation(item.id)"
          >
            <span class="ai-history-item-title"><AppIcon v-if="item.pinned" name="pin-fill" size="xs" />{{ item.title }}</span>
            <span v-if="item.match" class="ai-history-item-match">{{ item.match }}</span>
            <span v-if="item.active" class="ai-history-current"><AppIcon name="check" size="xs" />{{ t('common.current') }}</span>
            <span class="ai-history-item-meta">
              {{ t('ai.messageCount', { count: item.messageCount, time: formatHistoryTime(item.createdAt) }) }}
            </span>
          </button>
          <div class="ai-history-item-actions">
            <button type="button" class="ai-history-item-action" :title="t('ai.renameConversation')" :aria-label="t('ai.renameConversation')" @click="handleRenameConversation(item.id, item.customTitle || item.title, $event)"><AppIcon name="edit" size="xs" /></button>
            <button type="button" class="ai-history-item-action" :title="t(item.pinned ? 'ai.unpinConversation' : 'ai.pinConversation')" :aria-label="t(item.pinned ? 'ai.unpinConversation' : 'ai.pinConversation')" @click="handleTogglePin(item.id, item.pinned, $event)"><AppIcon :name="item.pinned ? 'pin-fill' : 'pin'" size="xs" /></button>
            <button type="button" class="ai-history-item-action danger" :title="t('ai.deleteHistoryItem')" :aria-label="t('ai.deleteHistoryItem')" @click="handleDeleteConversation(item.id, $event)"><AppIcon name="delete" size="xs" /></button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped src="./AiSidebar.css"></style>
