<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiChatSegment, AiToolRun, AiUsage } from '../../env.d.ts'
import { useMarkdownRenderer, type MarkdownBlock } from '@/composables/ai/useMarkdownRenderer'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import type { ChatItem } from '../../composables/ai/useAiChat'
import {
  toolRunDefaultOpen,
  type ToolRunSummary,
} from '@shared/aiToolRunDisplay'
import { isLiveReasoningSegment, reasoningLiveSnippet } from '@/utils/ai/chatReasoning'
import { activeTimelineTurnId, collectChatTimelineTurns } from '@/utils/ai/chatTimeline'
import { createToolRunDisplayCache } from '@/utils/ai/toolRunDisplayCache'
import { splitToolReason } from '@/utils/ai/toolReason'
import AppIcon from '../icons/AppIcon.vue'

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
  (e: 'edit-resend', messageId: string, newText: string): void
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

const { toolView, toolArgsText } = createToolRunDisplayCache()

function isToolRunOpen(message: ChatItem, run: AiToolRun): boolean {
  return toolOpenState.get(toolRunKey(message, run)) === true
}

/** 单行化的 AI 操作说明，用于折叠态的工具行内展示（完整文本走 title 悬浮）。 */
function toolRunDescText(run: AiToolRun): string {
  return splitToolReason(run.reason).explanation.replace(/\s+/g, ' ').trim()
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

function toolRiskLabel(risk?: AiToolRun['risk']): string {
  if (risk === 'read') return t('ai.toolRiskRead')
  if (risk === 'write' || risk === 'destructive') return t('ai.toolRiskWrite')
  if (risk === 'privileged') return t('ai.toolRiskPrivileged')
  if (risk === 'forbidden') return t('ai.toolRiskForbidden')
  return ''
}

function isNonzeroExit(message: ChatItem, run: AiToolRun): boolean {
  if (!isToolRunOpen(message, run)) return false
  const summary = toolView(run).summary
  return summary.kind === 'exit' && summary.code !== 0
}

function toolRunStateLabel(message: ChatItem, run: AiToolRun): string {
  if (run.status === 'ask') return t('ai.toolWaitingApproval')
  if (run.status === 'running' || (message.streaming && !run.content && run.status !== 'done')) {
    return t('ai.toolRunning')
  }
  if (run.status === 'denied') return t('ai.toolDenied')
  if (run.status === 'blocked') return t('ai.toolBlocked')
  if (run.status === 'reclassify') return t('ai.toolReclassify')
  if (run.isError) return t('ai.toolFailed')
  if (!isToolRunOpen(message, run)) return t('ai.toolSummaryOk')
  return toolRunSummaryLabel(toolView(run).summary)
}

function toolRunStateTitle(message: ChatItem, run: AiToolRun): string {
  if (!isToolRunOpen(message, run)) return ''
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
  editingMessageId.value = ''
  editingText.value = ''
}

function confirmEdit(message: ChatItem) {
  const text = editingText.value.trim()
  if (!text || text === message.content.trim()) {
    cancelEdit()
    return
  }
  emit('edit-resend', message.id, text)
  cancelEdit()
}

function onEditKeydown(event: KeyboardEvent, message: ChatItem) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    confirmEdit(message)
  }
}

function formatUsageDetail(usage?: AiUsage): string {
  if (!usage) return ''
  const parts: string[] = []
  if (usage.promptTokens !== undefined) parts.push(t('ai.usageInput', { n: usage.promptTokens }))
  if (usage.completionTokens !== undefined) parts.push(t('ai.usageOutput', { n: usage.completionTokens }))
  if (usage.reasoningTokens !== undefined) parts.push(t('ai.usageReasoning', { n: usage.reasoningTokens }))
  if (usage.totalTokens !== undefined) parts.push(t('ai.usageTotal', { n: usage.totalTokens }))
  return parts.join(' · ')
}

function formatUsage(usage?: AiUsage): string {
  if (!usage) return ''
  if (usage.totalTokens !== undefined) return t('ai.usageCompact', { n: usage.totalTokens })
  const n = (usage.promptTokens || 0) + (usage.completionTokens || 0) + (usage.reasoningTokens || 0)
  return n > 0 ? t('ai.usageCompact', { n }) : ''
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
          @input="autoGrowEditInput"
          @keydown="onEditKeydown($event, message)"
        ></textarea>
        <div class="message-edit-actions">
          <button type="button" class="message-edit-btn" @click="cancelEdit">
            {{ t('common.cancel') }}
          </button>
          <button
            type="button"
            class="message-edit-btn primary"
            :disabled="!editingText.trim()"
            @click="confirmEdit(message)"
          >
            {{ t('ai.editResend') }}
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
          <span
            v-if="isReasoningLive(message, segIndex)"
            class="thinking-dots"
            aria-hidden="true"
          ><i /><i /><i /></span>
          <span
            class="reasoning-title"
            :class="{ 'ai-think-shimmer': isReasoningLive(message, segIndex) }"
          >
            {{ isReasoningLive(message, segIndex) ? t('ai.reasoningLive') : t('ai.reasoning') }}
          </span>
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
            (item.run.isError || item.run.status === 'denied' || item.run.status === 'blocked' || isNonzeroExit(message, item.run)),
          reclassify: item.run.status === 'reclassify',
          pending: item.run.status === 'running',
          ask: item.run.status === 'ask',
          danger: item.run.risk === 'destructive' || item.run.risk === 'privileged' || item.run.risk === 'forbidden',
        }"
        :open="isToolRunOpen(message, item.run)"
        @toggle="onToolRunToggle(message, item.run!, $event)"
      >
        <summary class="tool-run-head">
          <span class="tool-run-name">{{ toolNameLabel(item.run.name) }}</span>
          <span v-if="toolRiskLabel(item.run.risk)" class="tool-run-risk" :data-risk="item.run.risk">{{ toolRiskLabel(item.run.risk) }}</span>
          <span
            v-if="!isToolRunOpen(message, item.run) && toolRunDescText(item.run)"
            class="tool-run-desc"
            :title="toolRunDescText(item.run)"
          >{{ toolRunDescText(item.run) }}</span>
          <span v-if="isToolRunOpen(message, item.run) && toolView(item.run).hint" class="tool-run-hint" :title="toolView(item.run).hint">{{ toolView(item.run).hint }}</span>
          <span class="tool-run-state" :title="toolRunStateTitle(message, item.run)">{{ toolRunStateLabel(message, item.run) }}</span>
        </summary>
        <template v-if="isToolRunOpen(message, item.run)">
        <p v-if="splitToolReason(item.run.reason).explanation" class="tool-ask-copy"><strong>{{ t('ai.toolExplanationLabel') }}</strong>{{ splitToolReason(item.run.reason).explanation }}</p>
        <p v-if="splitToolReason(item.run.reason).notice" class="tool-ask-copy tool-policy-notice"><strong>{{ t('ai.toolPolicyNoticeLabel') }}</strong>{{ splitToolReason(item.run.reason).notice }}</p>
        <p v-if="item.run.diffSummary" class="tool-ask-copy">{{ item.run.diffSummary }}</p>
        <pre v-if="item.run.diffPreview" class="tool-run-out">{{ item.run.diffPreview }}</pre>
        <p v-if="item.run.status === 'blocked'" class="tool-ask-copy">{{ t('ai.toolAskForbidden') }}</p>
        <p v-if="item.run.status === 'reclassify'" class="tool-ask-copy">{{ t('ai.toolReclassifyHint') }}</p>
        <pre v-if="toolArgsText(item.run) && item.run.status !== 'denied'" class="tool-run-args">{{ toolArgsText(item.run) }}</pre>
        <pre v-if="toolView(item.run).body && item.run.status !== 'denied' && item.run.status !== 'blocked' && item.run.status !== 'reclassify'" class="tool-run-out">{{ toolView(item.run).body }}</pre>
        </template>
      </details>
      <div v-else-if="item.seg.kind === 'content'" class="message-content">
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
      <div v-if="message.streaming && !message.content && !message.reasoningContent" class="message-content">
        <span class="thinking" role="status">
          <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          <span class="thinking-label ai-think-shimmer">{{ t('ai.thinking') }}</span>
        </span>
      </div>
      </template>
      <div v-if="!message.streaming && !loading && editingMessageId !== message.id" class="message-footer">
        <span
          v-if="message.id === lastAssistantId && formatUsage(message.usage)"
          class="usage-line"
          :title="formatUsageDetail(message.usage)"
        >
          {{ formatUsage(message.usage) }}
        </span>
        <div class="message-actions">
          <template v-if="message.role === 'user'">
            <button
              v-if="message.id === lastUserMessageId"
              type="button"
              class="msg-action-btn"
              :title="t('ai.editMessage')"
              @click="startEdit(message)"
            >
              <AppIcon name="edit" size="xs" />
            </button>
            <button
              type="button"
              class="msg-action-btn"
              :title="t('ai.deleteMessage')"
              @click="emit('delete-message', message.id)"
            >
              <AppIcon name="delete" size="xs" />
            </button>
          </template>
          <template v-else>
            <button
              v-if="message.error"
              type="button"
              class="msg-action-btn"
              :title="t('ai.retry')"
              @click="emit('retry', message.id)"
            >
              <AppIcon name="refresh" size="xs" />
            </button>
            <button
              v-else-if="message.content"
              type="button"
              class="msg-action-btn"
              :title="t('ai.regenerate')"
              @click="emit('regenerate', message.id)"
            >
              <AppIcon name="refresh" size="xs" />
            </button>
            <button
              v-if="message.content"
              type="button"
              class="msg-action-btn"
              :title="copiedKey === `${message.id}-message` ? t('common.copied') : t('ai.copyReply')"
              @click="copyText(message.content, `${message.id}-message`)"
            >
              <AppIcon v-if="copiedKey === `${message.id}-message`" name="check" size="xs" />
              <AppIcon v-else name="copy" size="xs" />
            </button>
            <button
              type="button"
              class="msg-action-btn"
              :title="t('ai.deleteMessage')"
              @click="emit('delete-message', message.id)"
            >
              <AppIcon name="delete" size="xs" />
            </button>
          </template>
        </div>
      </div>
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

<style scoped>
.chat-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.chat-list.has-timeline {
  padding-left: 26px;
}

.empty-state {
  margin: auto 0;
  padding: 28px 12px;
}

.empty-mark {
  background: var(--accent-bg);
  color: var(--accent);
}

.empty-examples {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.empty-example-chip {
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  text-align: left;
}

.empty-example-chip:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border-color));
  color: var(--text-primary);
  background: var(--accent-bg);
}

.context-omit {
  align-self: center;
  max-width: 100%;
  padding: 5px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  z-index: 2;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}

.jump-latest:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.chat-timeline {
  position: absolute;
  top: 50%;
  left: 2px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 16px;
  max-height: calc(100% - 20px);
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 2px;
  border-radius: 10px;
  transform: translateY(-50%);
  user-select: none;
}

.chat-timeline:hover {
  width: 168px;
  max-width: calc(100% - 12px);
  padding: 4px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

.chat-timeline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  padding: 2px 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.chat-timeline-item:hover {
  background: var(--accent-bg);
  color: var(--text-primary);
}

.chat-timeline-dash {
  flex-shrink: 0;
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-secondary);
  opacity: 0.55;
}

.chat-timeline-item.active .chat-timeline-dash {
  width: 12px;
  background: var(--accent);
  opacity: 1;
}

.chat-timeline-item-preview {
  display: none;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-primary);
}

.chat-timeline:hover .chat-timeline-item-preview {
  display: block;
}

.code-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.code-action-btn {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  padding: 2px 6px;
  cursor: pointer;
}

.code-action-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.code-action-btn.primary {
  color: var(--accent);
}

.chat-row {
  display: flex;
  flex-direction: column;
  max-width: 100%;
}

.chat-row.user {
  align-items: flex-end;
}

.chat-row.assistant {
  align-items: stretch;
}

.message-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}

.chat-row.user .message-stack {
  max-width: 82%;
  align-items: flex-end;
}

.message-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  width: 100%;
}

.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

/* 用户消息的编辑/删除按钮默认隐藏，悬停或键盘聚焦时显示 */
.chat-row.user .message-actions {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.chat-row.user:hover .message-actions,
.chat-row.user:focus-within .message-actions {
  opacity: 1;
  pointer-events: auto;
}

.msg-action-btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.msg-action-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.message-content {
  position: relative;
  max-width: 100%;
  word-break: break-word;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
}

.chat-row.user .message-content {
  background: var(--accent-bg);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: 16px 16px 6px 16px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.55;
}

/* 用户消息气泡内行内编辑 */
.message-edit-box {
  width: 100%;
  min-width: 260px;
  background: var(--accent-bg);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 16px 16px 6px 16px;
  padding: 8px 10px;
}

.message-edit-input {
  width: 100%;
  min-height: 60px;
  max-height: 240px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  padding: 2px 4px;
  overflow-y: auto;
}

.message-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

.message-edit-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.message-edit-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.message-edit-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.message-edit-btn.primary:hover {
  filter: brightness(1.08);
}

.message-edit-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: none;
}

.chat-row.assistant .message-content {
  background: transparent;
  border: none;
  padding: 2px 0 0;
  line-height: 1.7;
}

.chat-row.error .message-content {
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}

.thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.thinking-dots {
  display: inline-flex;
  gap: 3px;
}

.thinking-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.35;
  animation: ai-think 1s ease-in-out infinite;
}

.thinking-dots i:nth-child(2) { animation-delay: 0.15s; }
.thinking-dots i:nth-child(3) { animation-delay: 0.3s; }

.ai-think-shimmer {
  background-image: linear-gradient(
    90deg,
    var(--text-secondary) 0%,
    var(--accent) 42%,
    var(--text-primary) 50%,
    var(--accent) 58%,
    var(--text-secondary) 100%
  );
  background-size: 220% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  animation: ai-think-shimmer 1.7s linear infinite;
}

@keyframes ai-think {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

@keyframes ai-think-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.markdown-block + .markdown-block,
.markdown-block + .code-block,
.code-block + .markdown-block,
.code-block + .code-block {
  margin-top: 8px;
}

.markdown-block :deep(p) {
  margin: 0;
}

.markdown-streaming {
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-block :deep(h3),
.markdown-block :deep(h4),
.markdown-block :deep(h5),
.markdown-block :deep(h6) {
  margin: 8px 0 4px;
  font-size: 13px;
  line-height: 1.35;
}

.markdown-block :deep(h1),
.markdown-block :deep(h2) {
  margin: 10px 0 6px;
  font-size: 14px;
  line-height: 1.35;
}

.markdown-block :deep(ul),
.markdown-block :deep(ol) {
  margin: 4px 0 4px 16px;
  padding: 0;
}

.markdown-block :deep(li) {
  margin: 2px 0;
}

.markdown-block :deep(li.md-li-depth-1) { margin-left: 12px; }
.markdown-block :deep(li.md-li-depth-2) { margin-left: 24px; }
.markdown-block :deep(li.md-li-depth-3) { margin-left: 36px; }
.markdown-block :deep(li.md-li-depth-4) { margin-left: 48px; }

.markdown-block :deep(del) {
  text-decoration: line-through;
  opacity: 0.6;
}

.markdown-block :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 8px 0;
}

.markdown-block :deep(blockquote) {
  margin: 4px 0;
  padding: 4px 8px;
  border-left: 2px solid var(--accent);
  color: var(--text-secondary);
  background: var(--accent-bg);
}

.markdown-block :deep(code),
.markdown-code,
.code-language {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.markdown-block :deep(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-tertiary);
}

.markdown-block :deep(a) {
  color: var(--accent);
}

.markdown-block :deep(.md-image) {
  display: block;
  max-width: 100%;
  max-height: 240px;
  margin: 6px 0;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  object-fit: contain;
  background: var(--bg-tertiary);
}

.markdown-block :deep(.md-table-wrap) {
  overflow-x: auto;
  margin: 6px 0;
}

.markdown-block :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.markdown-block :deep(.md-table th),
.markdown-block :deep(.md-table td) {
  border: 1px solid var(--border-color);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}

.markdown-block :deep(.md-table th) {
  background: var(--bg-tertiary);
  font-weight: 600;
  color: var(--text-primary);
}

.markdown-block :deep(.md-table tr:nth-child(even) td) {
  background: color-mix(in srgb, var(--bg-tertiary) 35%, transparent);
}

.chat-list,
.message-content,
.reasoning-content,
.markdown-block,
.markdown-code {
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.code-block {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
}

.code-block-header {
  min-height: 28px;
  padding: 4px 6px 4px 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.code-language {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.copy-btn,
.message-copy-btn {
  width: 24px;
  height: 24px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.copy-btn:hover,
.message-copy-btn:hover {
  border-color: var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.message-copy-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
}

.message-content:hover .message-copy-btn,
.message-copy-btn:focus-visible {
  opacity: 1;
}

.markdown-code {
  margin: 0;
  padding: 8px;
  overflow-x: auto;
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
}

.tool-runs {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
}

.tool-run {
  padding: 1px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  font-size: 11px;
  color: var(--text-secondary);
}

.tool-run.error .tool-run-head {
  color: var(--danger);
}

.tool-run.reclassify .tool-run-head {
  color: var(--warning);
}

.tool-run.danger.ask .tool-run-name {
  color: var(--danger);
}

.tool-run.ask .tool-run-name {
  color: var(--accent);
}

.tool-run.pending .tool-run-state {
  color: var(--accent);
}

.tool-run > summary {
  cursor: pointer;
  list-style: none;
  border-radius: 5px;
}

.tool-run > summary:hover {
  background: var(--hover-bg);
}

.tool-run > summary::-webkit-details-marker,
.tool-run > summary::marker {
  display: none;
  content: '';
}

.tool-run-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  font-weight: 500;
  color: var(--text-secondary);
}

.tool-run-name {
  flex-shrink: 0;
  color: var(--text-primary);
}

.tool-run-name::before {
  content: '▸';
  display: inline-block;
  width: 1em;
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-run[open] .tool-run-name::before {
  content: '▾';
}

.tool-run-risk {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 500;
  padding: 0 4px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
}

.tool-run-risk[data-risk='destructive'],
.tool-run-risk[data-risk='privileged'],
.tool-run-risk[data-risk='forbidden'] {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.tool-run-desc {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: color-mix(in srgb, var(--text-secondary) 85%, transparent);
  cursor: help;
}

.tool-run-hint {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: var(--text-secondary);
}

.tool-run-state {
  margin-left: auto;
  flex-shrink: 0;
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-weight: 400;
}

.tool-ask-copy {
  margin: 2px 0 0 20px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  font-weight: 400;
}

.tool-run-args,
.tool-run-out {
  margin: 2px 0 2px 20px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  max-height: 280px;
  overflow: auto;
}

.reasoning-box {
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.reasoning-box.live {
  width: 100%;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-tertiary));
  box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 70%, transparent);
  color: var(--accent);
}

.reasoning-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  cursor: pointer;
  list-style: none;
  border-radius: 8px;
}

.reasoning-summary:hover {
  background: var(--hover-bg);
}

.reasoning-box > summary::-webkit-details-marker,
.reasoning-summary::-webkit-details-marker,
.reasoning-summary::marker {
  display: none;
  content: '';
}

.reasoning-title {
  flex-shrink: 0;
  font-weight: 500;
}

.reasoning-title:not(.ai-think-shimmer) {
  color: color-mix(in srgb, var(--text-secondary) 78%, transparent);
}

.reasoning-title::after {
  content: '›';
  display: inline-block;
  margin-left: 6px;
  color: var(--text-secondary);
  font-weight: 400;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}

.reasoning-summary:hover .reasoning-title::after,
.reasoning-box[open] .reasoning-title::after {
  opacity: 1;
}

.reasoning-box[open] .reasoning-title::after {
  transform: rotate(90deg);
}

.reasoning-snippet {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: var(--text-secondary);
}

.reasoning-content {
  padding: 0 10px 8px 26px;
  color: var(--text-secondary);
}

.usage-line {
  min-width: 0;
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.75;
}

.code-block {
  border-radius: 8px;
}

@media (prefers-reduced-motion: reduce) {
  .thinking-dots i,
  .ai-think-shimmer {
    animation: none;
  }

  .ai-think-shimmer {
    background: none;
    color: var(--accent);
  }
}
.tool-policy-notice { color: var(--warning); }
.tool-policy-notice strong { font-weight: 600; }
</style>
