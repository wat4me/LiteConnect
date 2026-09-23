<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiChatSegment, AiToolRun } from '../../env.d.ts'
import { useMarkdownRenderer, type MarkdownBlock } from '@/composables/ai/useMarkdownRenderer'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import type { ChatItem } from '../../composables/ai/useAiChat'
import {
  extractJsonStringField,
  toolRunDefaultOpen,
  type ToolRunSummary,
} from '@shared/aiToolRunDisplay'
import { isLiveReasoningSegment, reasoningLiveSnippet } from '@/utils/ai/chatReasoning'
import { activeTimelineTurnId, collectChatTimelineTurns } from '@/utils/ai/chatTimeline'
import { createToolRunDisplayCache } from '@/utils/ai/toolRunDisplayCache'
import { splitToolReason } from '@/utils/ai/toolReason'
import AppIcon from '../icons/AppIcon.vue'
import AiMessageFooter from './AiMessageFooter.vue'

const props = defineProps<{
  messages: ChatItem[]
  hasApiConfigured: boolean
  loading?: boolean
  contextDroppedCount?: number
}>()

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'fill-code', code: string): void
  (e: 'run-code', code: string): void
  (e: 'regenerate', messageId: string): void
  (e: 'retry', messageId: string): void
  (e: 'edit-resend', messageId: string, newText: string, done: (success: boolean) => void): void
  (e: 'delete-message', messageId: string): void
  (e: 'use-example', text: string): void
}>()

const examplePrompts = computed(() => [
  t('ai.exampleExplainError'),
  t('ai.exampleDiskCheck'),
  t('ai.exampleSafeCommand'),
])

const { t } = useI18n()
const { parseMarkdown } = useMarkdownRenderer()
const toolNameLabel = useAiToolNameLabel()

const markdownCache = new Map<string, { content: string; blocks: MarkdownBlock[] }>()
function parseSegmentMarkdown(message: ChatItem, segIndex: number, text: string): MarkdownBlock[] {
  const key = `${message.id}::seg${segIndex}`
  const cached = markdownCache.get(key)
  if (cached && cached.content === text) return cached.blocks
  const blocks = parseMarkdown(text)
  markdownCache.set(key, { content: text, blocks })
  return blocks
}

watch(() => props.messages, (msgs) => {
  const ids = new Set(msgs.map((m) => m.id))
  for (const key of markdownCache.keys()) {
    const sep = key.indexOf('::')
    if (sep < 0 || !ids.has(key.slice(0, sep))) markdownCache.delete(key)
  }
}, { deep: false })

type DisplayItem = { seg: AiChatSegment; run?: AiToolRun }

/**
 * Render in recorded stream order (reasoning / content / tool as each arrived).
 * Messages without segments fall back to 思考过程 → 工具执行 → 正文.
 */
function displayItems(message: ChatItem): DisplayItem[] {
  let segments = message.segments
  if (!segments?.length) {
    const synthesized: AiChatSegment[] = []
    if (message.reasoningContent) synthesized.push({ kind: 'reasoning', text: message.reasoningContent })
    for (const run of message.toolRuns || []) synthesized.push({ kind: 'tool', runId: run.id })
    if (message.content) synthesized.push({ kind: 'content', text: message.content })
    segments = synthesized
  }
  return segments.map((seg) => ({
    seg,
    run: seg.kind === 'tool' ? (message.toolRuns || []).find((r) => r.id === seg.runId) : undefined,
  }))
}

const copiedKey = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

/**
 * KeepAlive detaches/re-attaches this panel when switching SSH sessions.
 * Browsers reset scrollTop to 0 on re-attach, so we save/restore explicitly.
 */
const listRef = ref<HTMLElement | null>(null)
/** When on, stream updates pin the viewport to the latest output (default). */
const followLatest = ref(true)
let savedScrollTop = 0
let isProgrammaticScroll = false
let scrollRaf = 0
const NEAR_BOTTOM_PX = 48

const timelineTurns = computed(() => collectChatTimelineTurns(props.messages))
const showTimeline = computed(() => timelineTurns.value.length > 0 && props.messages.length > 1)
const activeTurnId = ref('')
let jumpScrollTimer: ReturnType<typeof setTimeout> | null = null

function captureScroll() {
  const el = listRef.value
  if (el) savedScrollTop = el.scrollTop
}

function restoreScroll() {
  const el = listRef.value
  if (!el) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  el.scrollTop = Math.min(Math.max(0, savedScrollTop), max)
}

function isNearBottom(el: HTMLElement, threshold = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}

function scrollToBottom() {
  const el = listRef.value
  if (!el) return
  isProgrammaticScroll = true
  el.scrollTop = el.scrollHeight
  savedScrollTop = el.scrollTop
  requestAnimationFrame(() => {
    isProgrammaticScroll = false
  })
}

function scheduleScrollToBottom() {
  if (!followLatest.value) return
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    scrollToBottom()
  })
}

function updateActiveTurn() {
  const el = listRef.value
  const turns = timelineTurns.value
  if (!el || !turns.length) {
    activeTurnId.value = ''
    return
  }
  if (followLatest.value) {
    activeTurnId.value = turns[turns.length - 1]?.id || ''
    return
  }
  const measured = turns.map((turn) => {
    const row = el.querySelector(`[data-message-id="${CSS.escape(turn.id)}"]`) as HTMLElement | null
    return { id: turn.id, top: row ? row.offsetTop : 0 }
  })
  activeTurnId.value = activeTimelineTurnId(measured, el.scrollTop)
}

function jumpToTurn(id: string) {
  const el = listRef.value
  if (!el) return
  const row = el.querySelector(`[data-message-id="${CSS.escape(id)}"]`) as HTMLElement | null
  if (!row) return
  followLatest.value = false
  activeTurnId.value = id
  isProgrammaticScroll = true
  const top = Math.max(0, row.offsetTop - 8)
  el.scrollTo({ top, behavior: 'smooth' })
  savedScrollTop = top
  if (jumpScrollTimer) clearTimeout(jumpScrollTimer)
  jumpScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false
    captureScroll()
    updateActiveTurn()
    jumpScrollTimer = null
  }, 420)
}

function onListScroll() {
  if (isProgrammaticScroll) {
    captureScroll()
    updateActiveTurn()
    return
  }
  captureScroll()
  const el = listRef.value
  if (!el) return
  // Manual scroll away from tail pauses follow; return to bottom re-enables.
  if (followLatest.value && !isNearBottom(el)) {
    followLatest.value = false
  } else if (!followLatest.value && isNearBottom(el)) {
    followLatest.value = true
  }
  updateActiveTurn()
}

function toggleFollowLatest() {
  followLatest.value = !followLatest.value
  if (followLatest.value) {
    void nextTick(() => scheduleScrollToBottom())
  }
}

/** Cheap signature so streaming token updates trigger follow-scroll. */
const messagesSignature = computed(() =>
  props.messages
    .map(
      (m) =>
        `${m.id}:${m.content.length}:${(m.reasoningContent || '').length}:${m.streaming ? 1 : 0}:${(m.segments || [])
          .map((s) => (s.kind === 'tool' ? `t${s.runId}` : `${s.kind}${s.text.length}`))
          .join(',')}:${(m.toolRuns || [])
          .map((r) => `${r.id}:${r.content.length}:${r.isError ? 1 : 0}:${r.status || ''}`)
          .join(',')}`,
    )
    .join('|'),
)

const toolOpenState = reactive(new Map<string, boolean>())
const reasoningOpenState = reactive(new Map<string, boolean>())

function toolRunKey(message: ChatItem, run: AiToolRun): string {
  return `${message.id}:${run.id}`
}

const { toolView } = createToolRunDisplayCache()

function isToolRunOpen(message: ChatItem, run: AiToolRun): boolean {
  return toolOpenState.get(toolRunKey(message, run)) === true
}

function toolRunExplanation(run: AiToolRun): string {
  return splitToolReason(run.reason).explanation
}

/** Prefer the model's purpose statement; retain a compact fallback for legacy history. */
function toolRunDescText(run: AiToolRun): string {
  return (toolRunExplanation(run) || toolView(run).hint).replace(/\s+/g, ' ').trim()
}

function toolInvocationLabel(run: AiToolRun): string {
  return extractJsonStringField(run.args || '', 'command') ? t('ai.toolCommand') : t('ai.toolParameters')
}

function onToolRunToggle(message: ChatItem, run: AiToolRun, event: Event) {
  const el = event.currentTarget as HTMLDetailsElement
  if (!el || el.tagName !== 'DETAILS') return
  toolOpenState.set(toolRunKey(message, run), el.open)
}

function isReasoningLive(message: ChatItem, segIndex: number): boolean {
  return isLiveReasoningSegment(message, segIndex)
}

function reasoningKey(message: ChatItem, segIndex: number): string {
  return `${message.id}:r${segIndex}`
}

function isReasoningOpen(message: ChatItem, segIndex: number): boolean {
  return reasoningOpenState.get(reasoningKey(message, segIndex)) === true
}

function onReasoningToggle(message: ChatItem, segIndex: number, event: Event) {
  const el = event.currentTarget as HTMLDetailsElement
  if (!el || el.tagName !== 'DETAILS') return
  reasoningOpenState.set(reasoningKey(message, segIndex), el.open)
}

function reasoningPreview(item: DisplayItem): string {
  if (item.seg.kind !== 'reasoning') return ''
  return reasoningLiveSnippet(item.seg.text)
}

function reasoningText(item: DisplayItem): string {
  return item.seg.kind === 'reasoning' ? item.seg.text : ''
}

watch(
  () =>
    props.messages
      .flatMap((m) => (m.toolRuns || []).map((r) => `${m.id}:${r.id}`))
      .join('|'),
  () => {
    for (const message of props.messages) {
      for (const run of message.toolRuns || []) {
        const key = toolRunKey(message, run)
        if (toolOpenState.has(key)) continue
        toolOpenState.set(key, toolRunDefaultOpen())
      }
    }
  },
  { immediate: true },
)

function isNonzeroExit(run: AiToolRun): boolean {
  const summary = toolView(run).summary
  return summary.kind === 'exit' && summary.code !== 0
}

function toolRunStateLabel(message: ChatItem, run: AiToolRun): string {
  if (run.status === 'ask') return t('ai.toolWaitingApproval')
  if (run.status === 'aborted') return t('ai.toolAborted')
  if (run.status === 'running' || (message.streaming && !run.content && run.status !== 'done')) {
    return t('ai.toolRunning')
  }
  if (run.status === 'denied') return t('ai.toolDenied')
  if (run.status === 'blocked') return t('ai.toolBlocked')
  if (run.status === 'reclassify') return t('ai.toolReclassify')
  if (run.isError) return t('ai.toolFailed')
  return toolRunSummaryLabel(toolView(run).summary)
}

function toolRunStateTitle(run: AiToolRun): string {
  const summary = toolView(run).summary
  if (summary.kind === 'exit') return t('ai.toolSummaryExitHint', { code: summary.code })
  return ''
}

function toolRunSummaryLabel(summary: ToolRunSummary): string {
  switch (summary.kind) {
    case 'ok':
      return t('ai.toolSummaryOk')
    case 'text':
      return summary.text
    case 'exit':
      if (summary.code === 0) {
        return summary.truncated ? t('ai.toolSummaryExitOkTruncated') : t('ai.toolSummaryExitOk')
      }
      return summary.truncated ? t('ai.toolSummaryExitFailTruncated') : t('ai.toolSummaryExitFail')
    case 'sessions':
      return t('ai.toolSummarySessions', { n: summary.count })
    case 'connections':
      return t('ai.toolSummaryConnections', { n: summary.count })
    case 'groups':
      return t('ai.toolSummaryGroups', { n: summary.count })
    case 'jobs':
      return t('ai.toolSummaryJobs', { n: summary.count })
    case 'entries':
      return t('ai.toolSummaryEntries', { n: summary.count })
    case 'ptys':
      return t('ai.toolSummaryPtys', { n: summary.count })
    default:
      return ''
  }
}

watch(
  [messagesSignature, () => props.loading, () => props.messages.length],
  async () => {
    await nextTick()
    updateActiveTurn()
    if (!followLatest.value) return
    scheduleScrollToBottom()
  },
  { immediate: true },
)

onDeactivated(() => {
  captureScroll()
})

onActivated(() => {
  nextTick(() => {
    if (followLatest.value) {
      scheduleScrollToBottom()
      requestAnimationFrame(() => {
        if (followLatest.value) scrollToBottom()
        updateActiveTurn()
      })
      return
    }
    restoreScroll()
    requestAnimationFrame(() => {
      restoreScroll()
      updateActiveTurn()
    })
  })
})

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  if (jumpScrollTimer) clearTimeout(jumpScrollTimer)
})

const lastAssistantId = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i]
    if (m.role === 'assistant' && !m.streaming) return m.id
  }
  return ''
})

/** 多轮对话中只有最后一条用户消息允许编辑（编辑会截断其后的对话） */
const lastUserMessageId = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i]
    if (m.role === 'user' && !m.streaming) return m.id
  }
  return ''
})

/** 气泡内行内编辑状态 */
const editingMessageId = ref('')
const editingText = ref('')
const editSubmitting = ref(false)
let editInputEl: HTMLTextAreaElement | null = null

function setEditInput(el: Element | ComponentPublicInstance | null) {
  editInputEl = el instanceof HTMLTextAreaElement ? el : null
}

function autoGrowEditInput() {
  const el = editInputEl
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function startEdit(message: ChatItem) {
  if (message.role !== 'user' || message.id !== lastUserMessageId.value) return
  editingMessageId.value = message.id
  editingText.value = message.content
  void nextTick(() => {
    const el = editInputEl
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autoGrowEditInput()
  })
}

function cancelEdit() {
  if (editSubmitting.value) return
  editingMessageId.value = ''
  editingText.value = ''
}

function confirmEdit(message: ChatItem) {
  const text = editingText.value.trim()
  if (!text || editSubmitting.value) return
  editSubmitting.value = true
  emit('edit-resend', message.id, text, (success) => {
    editSubmitting.value = false
    if (success) cancelEdit()
  })
}

function handleViewportInsetChange() {
  if (followLatest.value) scheduleScrollToBottom()
}

defineExpose({ handleViewportInsetChange })

function onEditKeydown(event: KeyboardEvent, message: ChatItem) {
  if (event.key === 'Escape' && !editSubmitting.value) {
    event.preventDefault()
    cancelEdit()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    confirmEdit(message)
  }
}

async function copyText(text: string, key: string) {
  const content = text.trim()
  if (!content) return
  try {
    await window.LiteConnect.clipboardWriteText(content)
    copiedKey.value = key
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
      copiedTimer = null
    }, 1400)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('common.copyFailed'))
  }
}
</script>

<template>
  <div class="chat-shell">
    <div
      ref="listRef"
      class="chat-list"
      :class="{ 'has-timeline': showTimeline }"
      @scroll.passive="onListScroll"
    >
      <div v-if="messages.length === 0" class="ui-empty empty-state">
        <div class="ui-empty-icon empty-mark" aria-hidden="true">
          <AppIcon name="ai-chat" size="xl" />
        </div>
        <div class="ui-empty-title">{{ t('ai.emptyTitle') }}</div>
        <div class="ui-empty-desc">
          {{ hasApiConfigured ? t('ai.emptyConfigured') : t('ai.emptyNoKey') }}
        </div>
        <div class="ui-empty-actions">
          <button v-if="!hasApiConfigured" type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="emit('open-settings')">
            {{ t('ai.openSettings') }}
          </button>
          <button v-else type="button" class="ui-btn ui-btn-sm" @click="emit('open-settings')">{{ t('ai.manageModels') }}</button>
        </div>
        <div v-if="hasApiConfigured" class="empty-examples">
          <button
            v-for="(example, i) in examplePrompts"
            :key="i"
            type="button"
            class="empty-example-chip"
            @click="emit('use-example', example)"
          >
            {{ example }}
          </button>
        </div>
      </div>
      <div
        v-if="messages.length > 0 && (contextDroppedCount || 0) > 0"
        class="context-omit"
        role="status"
      >
        {{ t('ai.contextOmitted', { n: contextDroppedCount }) }}
      </div>
      <div
        v-for="message in messages"
        :key="message.id"
        class="chat-row"
        :class="[message.role, { error: message.error, streaming: message.streaming }]"
        :data-message-id="message.id"
        :data-role="message.role"
      >
      <div class="message-stack">
      <div v-if="editingMessageId === message.id" class="message-edit-box">
        <textarea
          :ref="setEditInput"
          v-model="editingText"
          class="message-edit-input"
          :aria-label="t('ai.editMessage')"
          rows="3"
          :disabled="editSubmitting"
          @input="autoGrowEditInput"
          @keydown="onEditKeydown($event, message)"
        ></textarea>
        <div class="message-edit-actions">
          <button type="button" class="message-edit-btn" :disabled="editSubmitting" @click="cancelEdit">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="message-edit-btn primary"
            :disabled="!editingText.trim() || editSubmitting"
            @click="confirmEdit(message)"
          >
            {{ editSubmitting ? t('common.saving') : t('ai.editResend') }}
          </button>
        </div>
      </div>
      <template v-else>
      <template v-for="(item, segIndex) in displayItems(message)" :key="segIndex">
      <details
        v-if="item.seg.kind === 'reasoning'"
        class="reasoning-box"
        :class="{ live: isReasoningLive(message, segIndex) }"
        :open="isReasoningOpen(message, segIndex)"
        role="status"
        :aria-busy="isReasoningLive(message, segIndex) ? 'true' : undefined"
        @toggle="onReasoningToggle(message, segIndex, $event)"
      >
        <summary class="reasoning-summary">
          <AppIcon name="chevron-right" size="xs" class="details-chevron" />
          <span
            class="reasoning-title"
            :class="{ 'ai-think-shimmer': isReasoningLive(message, segIndex) }"
          >
            {{ isReasoningLive(message, segIndex) ? t('ai.reasoningLive') : t('ai.reasoning') }}
          </span>
          <span
            v-if="isReasoningLive(message, segIndex)"
            class="thinking-dots"
            aria-hidden="true"
          ><i /><i /><i /></span>
          <span
            v-if="isReasoningLive(message, segIndex) && !isReasoningOpen(message, segIndex) && reasoningPreview(item)"
            class="reasoning-snippet"
          >{{ reasoningPreview(item) }}</span>
        </summary>
        <div v-if="isReasoningOpen(message, segIndex)" class="reasoning-content">
          <div v-if="isReasoningLive(message, segIndex)" class="markdown-block markdown-streaming">{{ reasoningText(item) }}</div>
          <template v-else v-for="(block, index) in parseSegmentMarkdown(message, segIndex, reasoningText(item))" :key="index">
            <div v-if="block.type === 'code'" class="code-block">
              <div class="code-block-header">
                <span class="code-language">{{ block.language || 'text' }}</span>
                <button
                  type="button"
                  class="copy-btn"
                  :title="copiedKey === `${message.id}-seg${segIndex}-rcode-${index}` ? t('common.copied') : t('ai.copyCode')"
                  @click="copyText(block.content, `${message.id}-seg${segIndex}-rcode-${index}`)"
                >
                  <AppIcon v-if="copiedKey === `${message.id}-seg${segIndex}-rcode-${index}`" name="check" size="sm" />
                  <AppIcon v-else name="copy" size="sm" />
                </button>
              </div>
              <pre class="markdown-code"><code>{{ block.content }}</code></pre>
            </div>
            <div v-else class="markdown-block" v-html="block.content"></div>
          </template>
        </div>
      </details>
      <details
        v-else-if="item.seg.kind === 'tool' && item.run"
        class="tool-run"
        :class="{
          error:
            item.run.status !== 'reclassify' &&
            (item.run.isError || item.run.status === 'denied' || item.run.status === 'blocked' || isNonzeroExit(item.run)),
          reclassify: item.run.status === 'reclassify',
          pending: item.run.status === 'running',
          ask: item.run.status === 'ask',
          danger: item.run.risk === 'destructive' || item.run.risk === 'privileged' || item.run.risk === 'forbidden',
        }"
        :open="isToolRunOpen(message, item.run)"
        @toggle="onToolRunToggle(message, item.run!, $event)"
      >
        <summary class="tool-run-head">
          <AppIcon name="chevron-right" size="xs" class="details-chevron" />
          <span class="tool-run-name">{{ toolNameLabel(item.run.name) }}</span>
          <span
            v-if="!isToolRunOpen(message, item.run) && toolRunDescText(item.run)"
            class="tool-run-desc"
            :title="toolRunDescText(item.run)"
          >{{ toolRunDescText(item.run) }}</span>
          <span class="tool-run-state" :title="toolRunStateTitle(item.run)">{{ toolRunStateLabel(message, item.run) }}</span>
        </summary>
        <template v-if="isToolRunOpen(message, item.run)">
        <div v-if="toolRunExplanation(item.run)" class="tool-run-section tool-run-explanation-section">
          <div class="tool-run-section-label">{{ t('ai.toolExplanationLabel') }}</div>
          <div class="tool-run-explanation">{{ toolRunExplanation(item.run) }}</div>
        </div>
        <div v-if="toolView(item.run).hint && item.run.status !== 'denied'" class="tool-run-section">
          <div class="tool-run-section-label">{{ toolInvocationLabel(item.run) }}</div>
          <pre class="tool-run-args">{{ toolView(item.run).hint }}</pre>
        </div>
        <div v-if="item.run.diffPreview || (toolView(item.run).body && item.run.status !== 'denied' && item.run.status !== 'blocked' && item.run.status !== 'reclassify') || item.run.status === 'blocked' || item.run.status === 'reclassify'" class="tool-run-section">
          <div class="tool-run-section-label">{{ t('ai.toolExecutionResult') }}</div>
          <div v-if="item.run.diffSummary" class="tool-run-result-summary">{{ item.run.diffSummary }}</div>
          <pre v-if="item.run.diffPreview" class="tool-run-out">{{ item.run.diffPreview }}</pre>
          <pre v-else-if="toolView(item.run).body && item.run.status !== 'denied' && item.run.status !== 'blocked' && item.run.status !== 'reclassify'" class="tool-run-out">{{ toolView(item.run).body }}</pre>
          <div v-else-if="item.run.status === 'blocked'" class="tool-run-result-summary">{{ t('ai.toolAskForbidden') }}</div>
          <div v-else-if="item.run.status === 'reclassify'" class="tool-run-result-summary">{{ t('ai.toolReclassifyHint') }}</div>
        </div>
        </template>
      </details>
      <div v-else-if="item.seg.kind === 'content'" class="message-content">
        <!-- Parsing the whole growing response on every stream chunk can saturate the
             renderer for very long replies. Render once when the turn settles. -->
        <div v-if="message.streaming" class="markdown-block markdown-streaming">{{ item.seg.kind === 'content' ? item.seg.text : '' }}</div>
        <template v-else v-for="(block, index) in parseSegmentMarkdown(message, segIndex, item.seg.kind === 'content' ? item.seg.text : '')" :key="index">
          <div v-if="block.type === 'code'" class="code-block">
            <div class="code-block-header">
              <span class="code-language">{{ block.language || 'text' }}</span>
              <div class="code-actions">
                <button type="button" class="code-action-btn" :title="t('ai.fillTerminal')" @click="emit('fill-code', block.content)">{{ t('ai.fill') }}</button>
                <button type="button" class="code-action-btn primary" :title="t('ai.runTerminal')" @click="emit('run-code', block.content)">{{ t('ai.run') }}</button>
                <button
                  type="button"
                  class="copy-btn"
                  :title="copiedKey === `${message.id}-seg${segIndex}-code-${index}` ? t('common.copied') : t('ai.copyCode')"
                  @click="copyText(block.content, `${message.id}-seg${segIndex}-code-${index}`)"
                >
                  <AppIcon v-if="copiedKey === `${message.id}-seg${segIndex}-code-${index}`" name="check" size="sm" />
                  <AppIcon v-else name="copy" size="sm" />
                </button>
              </div>
            </div>
            <pre class="markdown-code"><code>{{ block.content }}</code></pre>
          </div>
          <div v-else class="markdown-block" v-html="block.content"></div>
        </template>
      </div>
      </template>
      <details
        v-if="message.streaming && !message.content && !message.reasoningContent"
        class="reasoning-box live reasoning-pending"
        role="status"
        aria-busy="true"
      >
        <summary class="reasoning-summary">
          <span class="reasoning-title ai-think-shimmer">{{ t('ai.reasoningLive') }}</span>
          <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
        </summary>
      </details>
      </template>
      <AiMessageFooter
        v-if="editingMessageId !== message.id && (message.role === 'user' || !message.streaming)"
        :message="message"
        :loading="!!loading"
        :last-assistant-id="lastAssistantId"
        :last-user-message-id="lastUserMessageId"
        :copied-key="copiedKey"
        @edit="startEdit(message)"
        @delete="emit('delete-message', message.id)"
        @retry="emit('retry', message.id)"
        @regenerate="emit('regenerate', message.id)"
        @copy="copyText(message.content, `${message.id}-message`)"
      />
      </div>
    </div>
    </div>
    <nav
      v-if="showTimeline"
      class="chat-timeline"
      :aria-label="t('ai.timelineAria')"
    >
      <button
        v-for="turn in timelineTurns"
        :key="turn.id"
        type="button"
        class="chat-timeline-item"
        :class="{ active: turn.id === activeTurnId }"
        :aria-current="turn.id === activeTurnId ? 'true' : undefined"
        :title="t('ai.timelineJump')"
        @click="jumpToTurn(turn.id)"
      >
        <span class="chat-timeline-dash" aria-hidden="true" />
        <span class="chat-timeline-item-preview">{{ turn.preview }}</span>
      </button>
    </nav>
    <button
      v-if="messages.length > 0 && !followLatest"
      type="button"
      class="jump-latest"
      :title="t('ai.followLatestOff')"
      @click="toggleFollowLatest"
    >
      {{ t('ai.jumpToLatest') }}
    </button>
  </div>
</template>

<style scoped src="./AiChatView.css"></style>
