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
import { estimateSidebarAiRequest } from '@shared/aiSidebarPrompt'
import { isAiMarkdownFilePath } from '@shared/aiFixedContext'
import { formatToolRunDisplay } from '@shared/aiToolRunDisplay'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import { diffPreviewRows } from '@/utils/ai/diffPreviewRows'
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
const contextFileSourceStatus = ref<Record<string, 'checking' | 'available' | 'missing' | 'unavailable'>>({})
const contextFileKey = (file: AiConversationContextFile) => `${file.source}:${file.path}`
let contextFileCheckVersion = 0

async function checkContextFileSource() {
  const version = ++contextFileCheckVersion
  if (!props.active) {
    contextFileSourceStatus.value = {}
    return
  }
  const files = [...contextFiles.value]
  contextFileSourceStatus.value = Object.fromEntries(files.map(file => [contextFileKey(file), 'checking']))
  await Promise.all(files.map(async file => {
    let status: 'available' | 'missing' | 'unavailable'
    try {
      if (file.source === 'local') status = await window.LiteConnect.aiCheckLocalContextFile(file.path)
      else {
        const stat = await window.LiteConnect.sftpStat(props.sessionId, file.path)
        status = stat.isDirectory ? 'missing' : 'available'
      }
    } catch (error: any) {
      status = file.source === 'ssh' && /no such file|not found|does not exist|不存在/i.test(String(error?.message || ''))
        ? 'missing' : 'unavailable'
    }
    if (version === contextFileCheckVersion) contextFileSourceStatus.value[contextFileKey(file)] = status
  }))
}

watch([contextFiles, () => props.active, () => props.openGeneration, () => props.sessionId], () => {
  void checkContextFileSource()
}, { immediate: true })

function onContextFileMenuToggle() {
  if (contextFileMenuRef.value?.open) void checkContextFileSource()
}
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
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 19.5
  const form = el.closest('form')!
  const formStyle = getComputedStyle(form)
  const toolbarHeight = form.querySelector('.composer-actions')?.getBoundingClientRect().height || 30
  const referenceHeight = form.querySelector('.composer-reference-list')?.getBoundingClientRect().height || 0
  const statusHeight = panel.querySelector('.composer-context-warning')?.getBoundingClientRect().height || 0
  const chromeHeight = statusHeight + 4 + toolbarHeight + referenceHeight + parseFloat(formStyle.paddingTop) + parseFloat(formStyle.paddingBottom) + parseFloat(formStyle.rowGap) * (referenceHeight ? 2 : 1) + 2
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
watch([input, showSettings, showHistory, contextFiles], () => { void nextTick(resizeComposer) })
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
let openPreparationPromise: Promise<void> | null = null
let handledOpenGeneration = 0
const canSend = computed(() => input.value.trim().length > 0 && !loading.value && !savingComposer.value && !contextFileBusy.value)

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

async function handleSwitchConversation(threadId: string) {
  if (loading.value || contextFileBusy.value) return
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

async function handleEditResend(
  messageId: string,
  newText: string,
  done: (success: boolean) => void,
) {
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
  showModelSwitcher.value = false
  contextFileMenuRef.value?.removeAttribute('open')
  closeSettingsPanel()
  closeHistoryPanel()
}

function closeContextFileMenuOnOutsideClick(event: PointerEvent) {
  if (!contextFileMenuRef.value?.contains(event.target as Node)) {
    contextFileMenuRef.value?.removeAttribute('open')
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
      <div v-if="contextFiles.length" class="composer-reference-list">
        <div v-for="file in contextFiles" :key="contextFileKey(file)" class="composer-reference" :title="file.path">
          <AppIcon name="file-text" size="sm" />
          <div class="composer-reference-info">
            <div class="composer-reference-title">
              <strong class="composer-reference-name">{{ contextFileName(file) }}</strong>
              <span class="composer-reference-source" :class="file.source">{{ file.source === 'ssh' ? t('ai.contextFileSourceSsh') : t('ai.contextFileSourceLocal') }}</span>
            </div>
            <span class="composer-reference-path">{{ file.path }}</span>
            <span v-if="contextFileSourceStatus[contextFileKey(file)] === 'missing'" class="composer-reference-status missing">{{ t('ai.contextFileMissing') }}</span>
            <span v-else-if="contextFileSourceStatus[contextFileKey(file)] === 'unavailable'" class="composer-reference-status">{{ t('ai.contextFileUnavailable') }}</span>
          </div>
          <button type="button" class="composer-reference-remove" :disabled="loading || contextFileBusy" :aria-label="t('ai.contextFileRemoveNamed', { name: contextFileName(file) })" :title="t('ai.contextFileRemove')" @click="removeContextFile(file)"><AppIcon name="close" size="xs" /></button>
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
            <summary :aria-label="t('ai.contextFileMenu')" :title="t('ai.contextFileSnapshotHint')">
              <AppIcon name="file-text" size="sm" />
              <span class="composer-context-label">{{ contextFiles.length ? t('ai.contextFileCount', { count: contextFiles.length }) : t('ai.contextFileMenu') }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </summary>
            <div class="composer-context-dropdown">
              <div v-for="file in contextFiles" :key="contextFileKey(file)" class="composer-context-selected">
                <div class="composer-reference-title">
                  <strong class="composer-reference-name">{{ contextFileName(file) }}</strong>
                  <span class="composer-reference-source" :class="file.source">{{ file.source === 'ssh' ? t('ai.contextFileSourceSsh') : t('ai.contextFileSourceLocal') }}</span>
                </div>
                <span>{{ file.path }}</span>
                <small v-if="contextFileSourceStatus[contextFileKey(file)] === 'missing'" class="missing">{{ t('ai.contextFileMissing') }}</small>
                <small v-else-if="contextFileSourceStatus[contextFileKey(file)] === 'unavailable'">{{ t('ai.contextFileUnavailable') }}</small>
                <button type="button" :disabled="loading || contextFileBusy" @click="removeContextFile(file)">{{ t('ai.contextFileRemove') }}</button>
              </div>
              <div class="composer-context-help">{{ t('ai.contextFileMenuHint') }}</div>
              <button type="button" :disabled="loading || contextFileBusy" @click="chooseLocalContextFile">{{ t('ai.contextFileLocal') }}</button>
              <button type="button" :disabled="loading || contextFileBusy" @click="chooseSshContextFile">{{ t('ai.contextFileSsh') }}</button>
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
  container-type: inline-size;
  container-name: ai-sidebar;
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
  justify-content: center;
  gap: 3px;
  max-width: 100%;
  min-width: 0;
  min-height: 28px;
  box-sizing: border-box;
  padding: 2px 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  cursor: pointer;
  transition: all 0.15s;
}

.ai-model-switcher:hover,
.ai-model-switcher.active {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.ai-model-switcher-name {
  min-width: 0;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-model-switcher :deep(.app-icon) {
  flex-shrink: 0;
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
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
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
  margin: 0 14px var(--ai-composer-overlay-inset, 150px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(30vh, 260px);
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  flex-shrink: 1;
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

.tool-approval-queued {
  padding: 2px 4px;
  color: var(--text-secondary);
  font-size: 10px;
  text-align: center;
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
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 10px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 96px;
  overflow: auto;
}

.tool-approval-diff {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tool-approval-details {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-tertiary) 32%, transparent);
  overflow: hidden;
}

.ai-body :deep(.chat-list) {
  padding-bottom: var(--ai-composer-overlay-inset, 150px);
  scroll-padding-bottom: var(--ai-composer-overlay-inset, 150px);
}

.tool-approval-details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  list-style: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.tool-approval-details > summary::-webkit-details-marker,
.tool-approval-details > summary::marker {
  display: none;
  content: '';
}

.tool-approval-details .details-chevron {
  flex-shrink: 0;
  transition: transform 0.12s ease;
}

.tool-approval-details > summary > span:first-of-type {
  margin-right: auto;
}

.tool-approval-details[open] > summary .details-chevron {
  transform: rotate(90deg);
}

.tool-approval-details-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 132px;
  padding: 0 6px 6px;
  overflow: auto;
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
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
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
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 2px;
  background: var(--bg-secondary);
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
.header-more summary { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; list-style: none; padding: 4px 6px; color: var(--text-secondary); }
.header-more summary::-webkit-details-marker { display: none; }
.header-more-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 128px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
}
.header-more-menu button {
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.header-more-menu button:hover { background: var(--hover-bg); }
.header-more-menu button:disabled { opacity: 0.5; cursor: not-allowed; }
.composer-reference-list { display: flex; flex-direction: column; gap: 4px; max-height: min(22vh, 150px); overflow-y: auto; min-height: 0; scrollbar-color: var(--scrollbar-thumb) transparent; }
.composer-reference {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.35;
}
.composer-reference > :deep(.app-icon) { flex-shrink: 0; color: var(--accent); }
.composer-reference-info { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.composer-reference-title { display: flex; align-items: center; gap: 6px; min-width: 0; }
.composer-reference-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.composer-reference-path { color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary)); overflow-wrap: anywhere; max-height: 2.7em; overflow: hidden; }
.composer-reference-status { color: var(--text-secondary); }
.composer-reference-status.missing { color: color-mix(in srgb, var(--warning) 40%, var(--text-primary)); }
.composer-reference-remove { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 24px; height: 24px; margin: -3px -4px 0 0; border: 0; border-radius: 5px; background: transparent; color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary)); cursor: pointer; }
.composer-reference-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.composer-reference-remove:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.composer-reference-remove:disabled { opacity: 0.5; cursor: not-allowed; }
.composer-context-menu { position: relative; flex: 0 1 auto; min-width: 0; }
.composer-context-menu summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  max-width: 136px;
  height: 34px;
  padding: 0 5px;
  border-radius: 6px;
  color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary));
  font-size: 11px;
  line-height: 1;
  list-style: none;
  cursor: pointer;
}
.composer-context-menu summary::-webkit-details-marker { display: none; }
.composer-context-menu summary:hover,
.composer-context-menu[open] summary { background: var(--hover-bg); color: var(--text-primary); }
.composer-context-menu.active summary { color: color-mix(in srgb, var(--accent) 40%, var(--text-primary)); }
.composer-context-menu summary :deep(.app-icon) { flex-shrink: 0; }
.composer-context-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer-context-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(210px, calc(100cqw - 12px));
  max-height: min(50vh, 360px);
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--overlay-bg) 55%, transparent);
}
.composer-context-selected {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  line-height: 1.4;
}
.composer-context-selected strong { font-weight: 600; overflow-wrap: anywhere; }
.composer-context-selected span { color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary)); overflow-wrap: anywhere; }
.composer-reference-title .composer-reference-source { flex-shrink: 0; padding: 1px 5px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 10px; line-height: 1.3; white-space: nowrap; }
.composer-reference-title .composer-reference-source.ssh { border-color: color-mix(in srgb, var(--accent) 35%, var(--border-color)); background: var(--accent-bg); color: color-mix(in srgb, var(--accent) 40%, var(--text-primary)); }
.composer-context-selected small { color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary)); font-size: 10px; }
.composer-context-selected small.missing { color: color-mix(in srgb, var(--warning) 40%, var(--text-primary)); }
.composer-context-help {
  padding: 5px 8px 7px;
  color: color-mix(in srgb, var(--text-secondary) 50%, var(--text-primary));
  font-size: 11px;
  line-height: 1.45;
}
.composer-context-dropdown button {
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.composer-context-dropdown button:hover { background: var(--hover-bg); }
.composer-context-dropdown button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.composer-context-dropdown button:disabled { opacity: 0.5; cursor: not-allowed; }
.composer-context-dropdown .composer-context-selected button { color: var(--danger); }
.composer-context-dropdown .composer-context-selected button:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.composer-area {
  position: absolute;
  z-index: 4;
  right: 14px;
  bottom: 12px;
  left: 14px;
  min-width: 0;
  container-type: inline-size;
  container-name: ai-composer;
}
.composer-permission:hover { color: var(--text-primary); }
.send-btn, .stop-btn { flex-shrink: 0; }
.composer { padding: 10px; gap: 8px; }
.composer-actions-right { width: 100%; gap: 6px; min-width: 0; }
.composer-permission-selector { display: flex; height: 34px; align-items: center; margin-left: auto; flex-shrink: 0; }
.model-switcher-wrap { flex: 0 1 auto; min-width: 0; max-width: 220px; height: 34px; align-items: center; }
.ai-model-switcher { height: 34px; min-height: 34px; width: auto; gap: 5px; font-family: inherit; font-size: 11px; line-height: 1.35; padding: 0 4px; justify-content: space-between; }
.ai-model-switcher:disabled { cursor: not-allowed; opacity: .5; }
.send-btn, .stop-btn { width: 38px; height: 38px; min-width: 38px; padding: 0; font-size: 11px; margin-left: 0; }
.composer-context-warning { font-size: 10px; color: var(--text-secondary); text-align: right; }
.composer-context-warning.warn { color: var(--warning); }
.composer-context-warning.danger { color: var(--danger); font-weight: 600; }
.model-context-info { padding: 6px; font-size: 11px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); }
@container ai-composer (max-width: 420px) {
  .composer-context-label { display: none; }
}
@container ai-composer (max-width: 220px) {
  .composer-actions-right { display: grid; grid-template-columns: minmax(0, 1fr) 38px; column-gap: 12px; row-gap: 3px; }
  .model-switcher-wrap { grid-column: 1; }
  .send-btn, .stop-btn { grid-column: 2; grid-row: 1 / 3; margin-left: 0; }
}
@container ai-sidebar (max-width: 480px) {
  .ai-header { gap: 6px; padding-left: 12px; padding-right: 8px; }
  .ai-header-actions { gap: 3px; }
}
.tool-policy-notice { color: var(--warning); }
.tool-policy-notice strong { font-weight: 600; }
</style>
