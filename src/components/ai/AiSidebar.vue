<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiConversationContextFile, AiSettings, AiToolRun } from '../../env.d.ts'
import { useAiChat, type ChatItem } from '../../composables/ai/useAiChat'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
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
import { projectAiHistoryForContext } from '@shared/aiCompaction'
import { estimateSidebarAiRequest, sidebarContextFilesFit } from '@shared/aiSidebarPrompt'
import { isAiMarkdownFilePath } from '@shared/aiFixedContext'
import { formatToolRunDisplay } from '@shared/aiToolRunDisplay'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import { useAiContextFileStatus } from '@/composables/ai/useAiContextFileStatus'
import { diffPreviewRows } from '@/utils/ai/diffPreviewRows'
import { useAiSidebarHistory } from '@/composables/ai/useAiSidebarHistory'
import { threadTitleTooltip } from '@/utils/ai/threadTitle'
import { sftpListedCwdState } from '@/utils/sftp/sftpListedCwd'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  sessionId: string
  active?: boolean
  /** Increments only when a previously closed AI panel opens for this SSH session. */
  openGeneration?: number
  selectionRequest?: {
    id: number
    sessionId: string
    text: string
    mode: 'send' | 'insert'
  } | null
}>(), { active: true, openGeneration: 0 })

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
  setConversationContextFile,
  removeConversationContextFile,
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
const contextFiles = computed(() => getSessionState(props.sessionId).contextFiles)
const contextFileName = (file: AiConversationContextFile) => file.path.split(/[\\/]/).pop() || file.path
const { contextFileSourceStatus, contextFileKey, checkContextFileSource } = useAiContextFileStatus({
  sessionId: () => props.sessionId,
  active: () => props.active,
  openGeneration: () => props.openGeneration,
  files: contextFiles,
})

function onContextFileMenuToggle() {
  if (contextFileMenuRef.value?.open) void checkContextFileSource()
}
const contextFilePreviewKey = ref('')
const previewContextFile = computed(() => contextFiles.value.find(file => contextFileKey(file) === contextFilePreviewKey.value) || null)
const composerAreaWidth = ref(0)
const visibleContextFiles = computed(() => contextFiles.value.slice(0, composerAreaWidth.value > 420 ? 5 : 2))
const overflowContextFiles = computed(() => contextFiles.value.slice(visibleContextFiles.value.length))
function toggleContextFilePreview(file: AiConversationContextFile) {
  const key = contextFileKey(file)
  contextFilePreviewKey.value = contextFilePreviewKey.value === key ? '' : key
}
function previewOverflowContextFile(file: AiConversationContextFile) {
  contextFileMenuRef.value?.removeAttribute('open')
  toggleContextFilePreview(file)
}
function contextFileStatusNote(file: AiConversationContextFile) {
  const status = contextFileSourceStatus.value[contextFileKey(file)]
  if (status === 'missing') return t('ai.contextFileMissing')
  if (status === 'unavailable') return t('ai.contextFileUnavailable')
  return ''
}
function contextFileTitle(file: AiConversationContextFile) {
  const note = contextFileStatusNote(file) || t('ai.contextFileSnapshotHint')
  return `${file.path}\n${note}`
}
function contextFileChipLabel(file: AiConversationContextFile) {
  const preview = t('ai.contextFilePreviewNamed', { name: contextFileName(file) })
  const note = contextFileStatusNote(file)
  return note ? `${preview}。${note}` : preview
}
watch(contextFiles, (files) => {
  if (contextFilePreviewKey.value && !files.some(file => contextFileKey(file) === contextFilePreviewKey.value)) {
    contextFilePreviewKey.value = ''
  }
})
const input = ref('')
const loading = ref(false)
watch(() => getSessionState(props.sessionId).loading, value => { loading.value = value })
const showSettings = ref(false)
const showModelSwitcher = ref(false)
const threadSummaries = ref(getSessionState(props.sessionId).threads)
const consumedSelectionIds = new Set<number>()
const settingsPanelRef = ref<InstanceType<typeof AiSettingsPanel> | null>(null)
const modelSwitcherButtonRef = ref<HTMLButtonElement | null>(null)
const modelSwitcherDropdownRef = ref<HTMLElement | null>(null)
const modelSwitcherStyle = ref<Record<string, string>>({})
const sidebarRef = ref<HTMLElement | null>(null)
const chatViewRef = ref<InstanceType<typeof AiChatView> | null>(null)
const composerAreaRef = ref<HTMLElement | null>(null)
const composerInputRef = ref<HTMLTextAreaElement | null>(null)
const contextFileMenuRef = ref<HTMLDetailsElement | null>(null)
let composerObserver: ResizeObserver | undefined
let composerLayoutRaf = 0
let composerOverlayInset = 0
let documentKeydownActive = false

function attachSidebarDomListeners() {
  if (!documentKeydownActive) {
    document.addEventListener('keydown', closePopoverOnEscape)
    document.addEventListener('pointerdown', closeContextFileMenuOnOutsideClick)
    documentKeydownActive = true
  }
  if (sidebarRef.value) composerObserver?.observe(sidebarRef.value)
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
  if (!el || !panel || !el.getClientRects().length) return
  composerAreaWidth.value = composerAreaRef.value?.clientWidth || 0
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.5
  const form = el.closest('form')!
  const formStyle = getComputedStyle(form)
  const toolbarHeight = form.querySelector('.composer-actions')?.getBoundingClientRect().height || 30
  const statusHeight = panel.querySelector('.composer-context-warning')?.getBoundingClientRect().height || 0
  const filesHeight = form.querySelector('.composer-context-files')?.getBoundingClientRect().height || 0
  const chromeHeight = statusHeight + filesHeight + 4 + toolbarHeight + parseFloat(formStyle.paddingTop) + parseFloat(formStyle.paddingBottom) + parseFloat(formStyle.rowGap) + 2
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
const contextFileBusy = ref(false)
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
  showHistory, historyQuery, historyItems, filteredHistoryItems,
  openHistoryPanel, closeHistoryPanel, handleSwitchConversation,
  handleDeleteConversation, handleClearAllHistory, formatHistoryTime,
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
  t: (key, params) => t(key, params ?? {}),
  closeModelSwitcher: () => { showModelSwitcher.value = false },
  closeSettings: () => { showSettings.value = false },
})
watch([input, showSettings, showHistory, contextFiles], () => { void nextTick(resizeComposer) })

const hasApiConfigured = computed(() => {
  const list = settings.value.providers || []
  return list.some((p) => (p.apiKey || '').trim().length > 0 && (p.baseUrl || '').trim().length > 0)
})

let initialLoadPromise: Promise<void> | null = null
let openPreparationPromise: Promise<void> | null = null
let handledOpenGeneration = 0
const contextFilesTooLong = computed(() => !sidebarContextFilesFit({
  systemPrompt: settings.value.systemPrompt,
  sessionId: props.sessionId,
  cwd: sftpListedCwdState()[props.sessionId],
  model: settings.value.activeModel || displayModelName.value,
  contextWindowTokens: activeContextWindowTokens.value,
  contextFiles: contextFiles.value,
}))
const canSend = computed(() => input.value.trim().length > 0 && !loading.value && !savingComposer.value && !contextFileBusy.value && !contextFilesTooLong.value)
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
const visibleApprovals = computed(() => pendingApprovals.value.slice(0, 1))

const resolvingApprovalIds = ref<Set<string>>(new Set())

function isApprovalResolving(runId: string): boolean {
  return resolvingApprovalIds.value.has(runId)
}

async function handleToolApproval(runId: string, approved: boolean): Promise<void> {
  if (isApprovalResolving(runId)) return
  resolvingApprovalIds.value = new Set(resolvingApprovalIds.value).add(runId)
  try {
    await resolveToolApproval(props.sessionId, runId, approved)
  } finally {
    const next = new Set(resolvingApprovalIds.value)
    next.delete(runId)
    resolvingApprovalIds.value = next
  }
}

function approvalHint(run: AiToolRun): string {
  return formatToolRunDisplay(run).hint
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
  const checkpoint = getSessionState(props.sessionId).contextCheckpoint
  const conv = checkpoint
    ? projectAiHistoryForContext(messages.value, checkpoint)
    : flattenConversationForApi(messages.value)
  if (!conv.length) return 0
  return estimateSidebarAiRequest({
    systemPrompt: settings.value.systemPrompt,
    messages: conv,
    sessionId: props.sessionId,
    cwd: sftpListedCwdState()[props.sessionId],
    model: settings.value.activeModel || displayModelName.value,
    contextWindowTokens: activeContextWindowTokens.value,
    contextFiles: contextFiles.value,
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
  if (props.active) attachSidebarDomListeners()
  syncFromState()
  void nextTick(resizeComposer)
  ensureOpenPrepared().catch(() => {})
})

onActivated(() => {
  if (!props.active) return
  attachSidebarDomListeners()
  void nextTick(resizeComposer)
  void refreshSettings().catch(() => {})
})

onDeactivated(() => {
  saveSessionInput(props.sessionId, input.value)
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
    saveSessionInput(props.sessionId, input.value)
    showModelSwitcher.value = false
    detachSidebarDomListeners()
  },
)

onBeforeUnmount(() => {
  saveSessionInput(props.sessionId, input.value)
  detachSidebarDomListeners()
  if (composerLayoutRaf) cancelAnimationFrame(composerLayoutRaf)
})

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (oldId) saveSessionInput(oldId, input.value)
    syncFromState()
    initialLoadPromise = null
    openPreparationPromise = null
    handledOpenGeneration = 0
    await ensureOpenPrepared()
  }
)

watch(
  () => props.openGeneration,
  (generation) => {
    if (!props.active || generation <= handledOpenGeneration) return
    void ensureOpenPrepared()
  },
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
    await ensureOpenPrepared()
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

async function ensureInitialLoad(syncUi = true) {
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
    })()
  }
  await initialLoadPromise
  if (syncUi) syncMessages(getSessionState(props.sessionId).messages)
}

/**
 * Reopening a closed AI panel starts from an empty draft while keeping prior
 * conversations in History. A running response is never moved mid-stream.
 */
async function ensureOpenPrepared() {
  if (openPreparationPromise) {
    await openPreparationPromise
    if (props.openGeneration <= handledOpenGeneration) return
  }

  const generation = props.openGeneration
  openPreparationPromise = (async () => {
    await ensureInitialLoad(false)
    const state = getSessionState(props.sessionId)
    if (generation > handledOpenGeneration) {
      handledOpenGeneration = generation
      if (!state.loading && state.messages.length > 0) {
        await startNewConversation(props.sessionId, syncMessages)
      }
    }
    syncMessages(state.messages)
  })()

  try {
    await openPreparationPromise
  } finally {
    openPreparationPromise = null
  }
}

async function handleNewConversation() {
  if (loading.value || contextFileBusy.value) return
  await startNewConversation(props.sessionId, syncMessages)
  syncFromState()
}

async function chooseLocalContextFile() {
  contextFileMenuRef.value?.removeAttribute('open')
  if (loading.value || contextFileBusy.value) return
  contextFileBusy.value = true
  try {
    await ensureInitialLoad(false)
    const file = await window.LiteConnect.aiSelectLocalContextFile()
    if (file) await setConversationContextFile(props.sessionId, file)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.contextFileFailed'))
  } finally {
    contextFileBusy.value = false
  }
}

async function chooseSshContextFile() {
  contextFileMenuRef.value?.removeAttribute('open')
  if (loading.value || contextFileBusy.value) return
  contextFileBusy.value = true
  let path: string
  try {
    await ensureInitialLoad(false)
    path = (await appPrompt({
      title: t('ai.contextFileSsh'),
      message: t('ai.contextFileSshHint'),
      inputPlaceholder: '/home/user/AGENTS.md',
      maxLength: 1024,
    })).trim()
  } catch {
    contextFileBusy.value = false
    return
  }
  if (!path) {
    contextFileBusy.value = false
    return
  }
  try {
    if (!isAiMarkdownFilePath(path)) throw new Error(t('ai.contextFileMarkdownOnly'))
    const content = await window.LiteConnect.sftpReadFile(props.sessionId, path)
    const file: AiConversationContextFile = { source: 'ssh', path, content }
    if (!content.trim() || content.includes('\0') || new TextEncoder().encode(content).length > 32 * 1024) {
      throw new Error(t('ai.contextFileInvalid'))
    }
    await setConversationContextFile(props.sessionId, file)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.contextFileFailed'))
  } finally {
    contextFileBusy.value = false
  }
}

async function removeContextFile(file: AiConversationContextFile) {
  if (loading.value || contextFileBusy.value) return
  contextFileBusy.value = true
  try {
    await ensureInitialLoad(false)
    await removeConversationContextFile(props.sessionId, file)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.contextFileFailed'))
  } finally {
    contextFileBusy.value = false
  }
}

async function handleRegenerate(messageId: string) {
  if (contextFilesTooLong.value) return
  loading.value = true
  try {
    await regenerateMessage(props.sessionId, messageId, syncMessages)
  } finally {
    loading.value = getSessionState(props.sessionId).loading
  }
}

async function handleRetry(messageId: string) {
  if (contextFilesTooLong.value) return
  loading.value = true
  try {
    await retryMessage(props.sessionId, messageId, syncMessages)
  } finally {
    loading.value = getSessionState(props.sessionId).loading
  }
}

async function handleEditResend(
  messageId: string,
  newText: string,
  done: (success: boolean) => void,
) {
  if (contextFilesTooLong.value) {
    done(false)
    return
  }
  let started = false
  try {
    const ok = await editUserMessageAndResend(
      props.sessionId,
      messageId,
      newText,
      syncMessages,
      () => {
        started = true
        done(true)
      },
    )
    if (!ok && !started) {
      done(false)
      ElMessage.warning(t('ai.editResendFailed'))
    }
  } catch (err: any) {
    if (!started) done(false)
    ElMessage.warning(err?.message || t('ai.editResendFailed'))
  }
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

async function onSettingsSaved(next: AiSettings) {
  replaceSettings(next)
  if (loading.value) return
  const history = await loadHistory(props.sessionId)
  const state = getSessionState(props.sessionId)
  state.messages.splice(0, state.messages.length, ...history)
  syncFromState()
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
  if (!content || savingComposer.value || contextFilesTooLong.value) return false
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
  await clearMessages(props.sessionId, syncMessages)
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
          <summary :aria-label="t('ai.moreActions')" :title="t('ai.moreActions')"><AppIcon name="more" size="sm" /></summary>
          <div class="header-more-menu">
            <button type="button" @click="clearCurrentHistory">{{ t('ai.clearChat') }}</button>
          </div>
        </details>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          :disabled="loading"
          :title="t('ai.newConversationHint')"
          @click="handleNewConversation"
        >
          <AppIcon name="plus" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :class="{ active: showHistory }" @click="openHistoryPanel" :title="t('ai.history')">
          <AppIcon name="history" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm header-settings-action" :class="{ active: showSettings }" @click="openSettingsPanel" :title="t('ai.settings')">
          <AppIcon name="settings" size="sm" />
        </button>
        <button class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="emit('close')" :title="t('ai.closePanel')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div v-show="!showSettings && !showHistory" class="ai-body">
      <AiChatView
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

    <div v-if="pendingApprovals.length && !showSettings && !showHistory" class="tool-approval-stack">
      <div
        v-for="run in visibleApprovals"
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
        <details v-if="approvalHint(run) || run.diffSummary || run.diffPreview" class="tool-approval-details" open>
          <summary>
            <AppIcon name="chevron-right" size="xs" class="details-chevron" />
            <span>{{ t('ai.toolApprovalDetails') }}</span>
            <span v-if="run.diffSummary" class="tool-approval-diff-summary">{{ run.diffSummary }}</span>
          </summary>
          <div class="tool-approval-details-body">
            <pre v-if="approvalHint(run)" class="tool-approval-hint" :title="approvalHint(run)">{{ approvalHint(run) }}</pre>
            <div v-if="run.diffPreview" class="tool-approval-diff">
              <pre class="tool-approval-diff-body"><span
                v-for="(row, i) in diffPreviewRows(run.diffPreview)"
                :key="i"
                class="diff-row"
                :class="`diff-${row.kind}`"
              >{{ row.text }}</span></pre>
            </div>
          </div>
        </details>
        <div class="tool-approval-actions">
          <button type="button" class="tool-approval-btn" :disabled="isApprovalResolving(run.id)" @click="handleToolApproval(run.id, false)">{{ t('ai.toolDeny') }}</button>
          <button
            type="button"
            class="tool-approval-btn primary"
            :disabled="isApprovalResolving(run.id)"
            @click="handleToolApproval(run.id, true)"
          >
            {{ t('ai.toolAllow') }}
          </button>
        </div>
      </div>
      <div v-if="pendingApprovals.length > 1" class="tool-approval-queued">
        {{ t('ai.toolApprovalQueued', { n: pendingApprovals.length - 1 }) }}
      </div>
    </div>

    <div ref="composerAreaRef" v-show="!showSettings && !showHistory" class="composer-area">
    <form class="composer" @submit.prevent="sendMessage">
      <div v-if="contextFiles.length" class="composer-context-files">
        <div class="composer-context-chips" role="list" :aria-label="t('ai.contextFileCount', { count: contextFiles.length })">
          <div
            v-for="file in visibleContextFiles"
            :key="contextFileKey(file)"
            class="composer-context-chip"
            role="listitem"
            :class="{
              missing: contextFileSourceStatus[contextFileKey(file)] === 'missing',
              previewing: contextFilePreviewKey === contextFileKey(file),
            }"
          >
            <button
              type="button"
              class="composer-context-chip-main"
              :aria-expanded="contextFilePreviewKey === contextFileKey(file)"
              :aria-label="contextFileChipLabel(file)"
              :title="contextFileTitle(file)"
              @click="toggleContextFilePreview(file)"
            >
              <AppIcon name="file-text" size="xs" />
              <span class="composer-context-chip-name">{{ contextFileName(file) }}</span>
              <span class="composer-reference-source" :class="file.source">{{ file.source === 'ssh' ? t('ai.contextFileSourceSsh') : t('ai.contextFileSourceLocal') }}</span>
              <span v-if="contextFileSourceStatus[contextFileKey(file)] === 'missing'" class="composer-context-chip-alert" :title="t('ai.contextFileMissing')">
                <AppIcon name="alert-triangle" size="xs" />
              </span>
              <span v-else-if="contextFileSourceStatus[contextFileKey(file)] === 'unavailable'" class="composer-context-chip-alert is-unavailable" :title="t('ai.contextFileUnavailable')">
                <AppIcon name="alert-circle" size="xs" />
              </span>
            </button>
            <button
              type="button"
              class="composer-context-chip-remove"
              :disabled="loading || contextFileBusy"
              :aria-label="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })"
              :title="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })"
              @click="removeContextFile(file)"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
          <div v-if="overflowContextFiles.length" class="composer-context-more-wrap" role="listitem">
            <button
              type="button"
              class="composer-context-more"
              :aria-label="t('ai.contextFileMore', { count: overflowContextFiles.length })"
              @click="contextFileMenuRef?.setAttribute('open', '')"
            >+{{ overflowContextFiles.length }}</button>
          </div>
        </div>
        <div v-if="previewContextFile" class="composer-context-preview">
          <div class="composer-context-preview-head">
            <span>{{ t('ai.contextFilePreviewCaption') }}</span>
            <span class="composer-context-preview-path" :title="previewContextFile.path">{{ previewContextFile.path }}</span>
          </div>
          <pre>{{ previewContextFile.content }}</pre>
        </div>
      </div>
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
          <details ref="contextFileMenuRef" class="composer-context-menu" :class="{ active: contextFiles.length > 0 }" @toggle="onContextFileMenuToggle">
            <summary :aria-label="t('ai.contextFileMenu')" :title="`${t('ai.contextFileMenuHint')} ${t('ai.contextFileSnapshotHint')}`">
              <AppIcon name="file-text" size="sm" />
              <span class="composer-context-label">{{ t('ai.contextFileMenu') }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </summary>
            <div class="composer-context-dropdown">
              <div v-if="overflowContextFiles.length" class="composer-context-overflow-list">
                <div v-for="file in overflowContextFiles" :key="contextFileKey(file)" class="composer-context-overflow-row">
                  <button type="button" class="composer-context-overflow-preview" :title="contextFileTitle(file)" @click="previewOverflowContextFile(file)">{{ contextFileName(file) }}</button>
                  <button type="button" class="composer-context-overflow-remove" :disabled="loading || contextFileBusy" :aria-label="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })" @click="removeContextFile(file)"><AppIcon name="close" size="xs" /></button>
                </div>
              </div>
              <div class="composer-context-help">{{ t('ai.contextFileMenuHint') }}</div>
              <button type="button" :disabled="loading || contextFileBusy || contextFiles.length >= 5" @click="chooseLocalContextFile">{{ t('ai.contextFileLocal') }}</button>
              <button type="button" :disabled="loading || contextFileBusy || contextFiles.length >= 5" @click="chooseSshContextFile">{{ t('ai.contextFileSsh') }}</button>
              <div class="composer-context-help">{{ t('ai.contextFileSnapshotHint') }}</div>
              <div v-if="contextFiles.length >= 5" class="composer-context-help">{{ t('ai.contextFileLimit') }}</div>
            </div>
          </details>
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

<style scoped src="./AiSidebar.css"></style>
