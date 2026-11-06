<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiChatSegment, AiToolRun } from '../../env.d.ts'
import { useMarkdownRenderer, type MarkdownBlock } from '@/composables/ai/useMarkdownRenderer'
import type { ChatItem } from '@/domain/ai/chat'
import { aiBackgroundResultNotices } from '@shared/aiBackgroundResults'
import {
  toolRunDefaultOpen,
} from '@shared/aiToolRunDisplay'
import { isLiveReasoningSegment, reasoningLiveSnippet } from '@/utils/ai/chatReasoning'
import { chatActivityDisplay } from '@/utils/ai/chatActivity'
import { isLiveContentSegment } from '@/utils/ai/chatSegments'
import { useAiChatViewport } from '@/composables/ai/useAiChatViewport'
import { useAiDisclosureState, toolDisclosureKey, reasoningDisclosureKey, processDisclosureKey } from '@/composables/ai/useAiDisclosureState'
import { chatProcessLayout, isChatContentBoundary, type ChatProcessGroup, type ChatProcessItem } from '@/utils/ai/chatProcess'
import AppIcon from '../icons/AppIcon.vue'
import AiMessageFooter from './AiMessageFooter.vue'
import AiImageStrip from './AiImageStrip.vue'
import AiToolRunRow from './AiToolRun.vue'
import AiWorkspaceResponse from './AiWorkspaceResponse.vue'
import AiStreamingMarkdown from './AiStreamingMarkdown.vue'
import AiBackgroundResults from './AiBackgroundResults.vue'
import AiActivityStatus from './AiActivityStatus.vue'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'

const props = defineProps<{
  messages: ChatItem[]
  conversationKey?: string
  terminalActions?: boolean
  workspaceHostCount?: number
  workspaceTargets?: AiWorkspaceTarget[]
  hasApiConfigured: boolean
  loading?: boolean
  contextDroppedCount?: number
}>()

const emit = defineEmits<{
  (e: 'view-execution', key: string): void
  (e: 'view-knowledge', run: AiToolRun): void
  (e: 'open-settings'): void
  (e: 'fill-code', code: string): void
  (e: 'run-code', code: string): void
  (e: 'regenerate', messageId: string): void
  (e: 'retry', messageId: string): void
  (e: 'edit-resend', messageId: string, newText: string, done: (success: boolean) => void): void
  (e: 'delete-message', messageId: string): void
  (e: 'use-example', text: string): void
}>()

const examplePrompts = computed(() => props.workspaceHostCount ? [t('ai.workspace.exampleCompare'), t('ai.workspace.exampleServices'), t('ai.workspace.exampleLogs')] : [
  t('ai.exampleExplainError'),
  t('ai.exampleDiskCheck'),
  t('ai.exampleSafeCommand'),
])

const { t } = useI18n()
const { parseMarkdown } = useMarkdownRenderer()
const activityNow = ref(Date.now())
let activityTimer: ReturnType<typeof setInterval> | undefined
let activityVisible = true
function syncActivityTimer() {
  if (activityTimer) clearInterval(activityTimer)
  activityTimer = undefined
  activityNow.value = Date.now()
  if (activityVisible && props.messages.some(message => message.streaming)) {
    activityTimer = setInterval(() => { activityNow.value = Date.now() }, 1000)
  }
}
watch(() => props.messages.some(message => message.streaming), syncActivityTimer, { immediate: true })

function activityDisplay(message: ChatItem) {
  return chatActivityDisplay(message.activity || {
    phase: 'waiting', phaseStartedAt: message.createdAt, lastActivityAt: message.createdAt,
  }, activityNow.value)
}

const markdownCache = new Map<string, { content: string; blocks: MarkdownBlock[] }>()
function parseSegmentMarkdown(message: ChatItem, segIndex: number, text: string): MarkdownBlock[] {
  const key = `${message.id}::seg${segIndex}`
  const cached = markdownCache.get(key)
  if (cached && cached.content === text) return cached.blocks
  const blocks = parseMarkdown(text)
  markdownCache.set(key, { content: text, blocks })
  return blocks
}

type DisplayItem = ChatProcessItem & { process?: ChatProcessGroup }

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
  const runs = new Map((message.toolRuns || []).map(run => [run.id, run]))
  const items: DisplayItem[] = segments.map((seg) => ({
    seg,
    run: seg.kind === 'tool' ? runs.get(seg.runId) : undefined,
  }))
  const layout = processLayout(message, items)
  items.forEach((item, index) => { item.process = layout.get(index) })
  return items
}

const copiedKey = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const { toolOpenState, reasoningOpenState, processOpenState } = useAiDisclosureState({
  messages: () => props.messages, conversationKey: () => props.conversationKey,
})

function toolRunKey(message: ChatItem, run: AiToolRun): string {
  return toolDisclosureKey(message.id, run.id)
}


function isToolRunOpen(message: ChatItem, run: AiToolRun): boolean {
  return toolOpenState.get(toolRunKey(message, run)) ?? toolRunDefaultOpen()
}

function onToolRunToggle(message: ChatItem, run: AiToolRun, open: boolean) {
  if (open) toolOpenState.set(toolRunKey(message, run), true)
  else toolOpenState.delete(toolRunKey(message, run))
}

const processLayouts = new WeakMap<ChatItem, { signature: string; layout: Map<number, ChatProcessGroup> }>()

/** Summarize the steps of one assistant turn independently of its disclosure state. */
function processLayout(message: ChatItem, items: ChatProcessItem[]): Map<number, ChatProcessGroup> {
  const signature = JSON.stringify([
    items.map(({ seg }) => seg.kind === 'tool' ? ['tool', seg.runId] : seg.kind === 'content' ? isChatContentBoundary(seg) : seg.kind),
    message.streaming, message.status, message.error,
    (message.toolRuns || []).map(run => [run.id, run.status ?? '', run.isError, run.content.length, run.risk ?? '']),
  ])
  const cached = processLayouts.get(message)
  if (cached && cached.signature === signature) return cached.layout
  const layout = chatProcessLayout({
    items, streaming: message.streaming, status: message.status, error: message.error,
  })
  processLayouts.set(message, { signature, layout })
  return layout
}

function isProcessOpen(message: ChatItem, group: ChatProcessGroup): boolean {
  return processOpenState.get(processDisclosureKey(message.id, group.firstRunId)) === true
}

function toggleProcess(message: ChatItem, group: ChatProcessGroup) {
  const key = processDisclosureKey(message.id, group.firstRunId)
  if (isProcessOpen(message, group)) processOpenState.delete(key)
  else processOpenState.set(key, true)
}

function processStepVisible(message: ChatItem, { process, run }: DisplayItem): boolean {
  return !process || isProcessOpen(message, process) || (!!run && process.pinnedRunIds.has(run.id))
}

function processTitle({ live, interrupted, stats }: ChatProcessGroup): string {
  const parts = [live
    ? t('ai.process.live', { step: stats.steps })
    : interrupted ? t('ai.process.interrupted', { steps: stats.steps }) : t('ai.process.done', { steps: stats.steps })]
  if (stats.changes) parts.push(t('ai.process.changes', { count: stats.changes }))
  if (stats.failed) parts.push(t('ai.process.failed', { count: stats.failed }))
  if (stats.blocked) parts.push(t('ai.process.blocked', { count: stats.blocked }))
  return parts.join(' · ')
}

function failureTitle(message: ChatItem): string {
  const failure = message.failure
  if (failure?.kind === 'http' && failure.status) return t('ai.chatFailure.http', { status: failure.status })
  if (failure?.kind === 'provider') return t('ai.chatFailure.provider')
  if (failure?.kind === 'request') return t('ai.chatFailure.request')
  if (failure?.kind === 'response') return t('ai.chatFailure.response')
  return message.content || message.toolRuns?.length ? t('ai.chatFailure.interrupted') : t('ai.requestFailed')
}

function isReasoningLive(message: ChatItem, segIndex: number): boolean {
  return isLiveReasoningSegment(message, segIndex) && activityDisplay(message).phase === 'reasoning'
}

function reasoningKey(message: ChatItem, segIndex: number): string {
  return reasoningDisclosureKey(message.id, segIndex)
}

function isReasoningOpen(message: ChatItem, segIndex: number): boolean {
  return reasoningOpenState.get(reasoningKey(message, segIndex)) === true
}

function onReasoningToggle(message: ChatItem, segIndex: number, event: Event) {
  const el = event.currentTarget as HTMLDetailsElement
  if (!el || el.tagName !== 'DETAILS') return
  if (el.open) reasoningOpenState.set(reasoningKey(message, segIndex), true)
  else reasoningOpenState.delete(reasoningKey(message, segIndex))
}

function reasoningPreview(item: DisplayItem): string {
  if (item.seg.kind !== 'reasoning') return ''
  return reasoningLiveSnippet(item.seg.text)
}

function reasoningText(item: DisplayItem): string {
  return item.seg.kind === 'reasoning' ? item.seg.text : ''
}

// Activity transitions can add lines without new stream text (for example the
// delayed-response hint). Follow only those layout changes, not every timer tick.
const activityLayoutSignature = computed(() => props.messages
  .filter(message => message.streaming)
  .map(message => {
    const activity = activityDisplay(message)
    return `${message.id}:${activity.phase}:${activity.delayed ? 1 : 0}`
  })
  .join('|'))

const { listRef, followLatest, timelineRef, showTimeline, activeTurnId,
  visibleMessages, hiddenTurnCount, hasEarlierMessages, loadingEarlier, loadEarlierMessages,
  timelineExpanded, visibleTimelineTurns, setTimelineHovered, onTimelineFocus,
  onTimelineBlur, jumpToTurn, onListScroll, toggleFollowLatest, handleViewportInsetChange,
} = useAiChatViewport({ messages: () => props.messages, loading: () => props.loading,
  layoutSignature: () => activityLayoutSignature.value, conversationKey: () => props.conversationKey })

watch(visibleMessages, (msgs) => {
  const ids = new Set(msgs.map(message => message.id))
  for (const key of markdownCache.keys()) {
    const sep = key.indexOf('::')
    if (sep < 0 || !ids.has(key.slice(0, sep))) markdownCache.delete(key)
  }
})

onDeactivated(() => {
  activityVisible = false
  syncActivityTimer()
})

onActivated(() => { activityVisible = true; syncActivityTimer() })

onBeforeUnmount(() => {
  if (activityTimer) clearInterval(activityTimer)
  if (copiedTimer) clearTimeout(copiedTimer)
})

const latestReplyId = computed(() => {
  const message = props.messages.at(-1)
  return message?.role === 'assistant' && !message.streaming && !props.loading ? message.id : undefined
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
  if ((!text && !message.images?.length) || editSubmitting.value) return
  editSubmitting.value = true
  emit('edit-resend', message.id, text, (success) => {
    editSubmitting.value = false
    if (success) cancelEdit()
  })
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
          {{ hasApiConfigured ? t(workspaceHostCount ? 'ai.workspace.emptyConfigured' : 'ai.emptyConfigured', { count: workspaceHostCount }) : t('ai.emptyNoKey') }}
        </div>
        <div v-if="!hasApiConfigured" class="ui-empty-actions">
          <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="emit('open-settings')">
            {{ t('ai.openSettings') }}
          </button>
        </div>
        <div v-if="hasApiConfigured" class="empty-examples">
          <button
            v-for="(example, i) in examplePrompts"
            :key="i"
            type="button"
            class="empty-example-chip"
            @click="emit('use-example', example)"
          >
            <span>{{ example }}</span>
            <AppIcon name="chevron-right" size="xs" aria-hidden="true" />
          </button>
        </div>
        <button v-if="hasApiConfigured" type="button" class="empty-model-settings" @click="emit('open-settings')">
          <AppIcon name="models" size="xs" aria-hidden="true" />{{ t('ai.manageModels') }}
        </button>
      </div>
      <div v-if="hasEarlierMessages" class="chat-load-earlier">
        <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" :disabled="loadingEarlier" :aria-busy="loadingEarlier" @click="loadEarlierMessages">
          {{ t(loadingEarlier ? 'ai.loadingEarlierTurns' : 'ai.loadEarlierTurns') }}
        </button>
        <span>{{ t('ai.hiddenEarlierTurns', { count: hiddenTurnCount }) }}</span>
      </div>
      <div
        v-if="messages.length > 0 && (contextDroppedCount || 0) > 0"
        class="context-omit"
        role="status"
      >
        {{ t('ai.contextOmitted', { n: contextDroppedCount }) }}
      </div>
      <div
        v-for="message in visibleMessages"
        :key="message.id"
        class="chat-row"
        :class="[message.role, { streaming: message.streaming, 'latest-reply': message.id === latestReplyId }]"
        :data-message-id="message.id"
        :data-role="message.role"
      >
      <div class="message-stack">
      <AiBackgroundResults v-for="(notice, noticeIndex) in aiBackgroundResultNotices(message)" :key="noticeIndex" :notice="notice" :targets="workspaceTargets" />
      <AiImageStrip v-if="message.images?.length" :images="message.images" />
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
            :disabled="(!editingText.trim() && !message.images?.length) || editSubmitting"
            @click="confirmEdit(message)"
          >
            {{ editSubmitting ? t('common.saving') : t('ai.editResend') }}
          </button>
        </div>
      </div>
      <template v-else>
      <template v-for="(item, segIndex) in displayItems(message)" :key="segIndex">
      <div v-if="item.process && item.process.start === segIndex" class="process-block" :class="{ live: item.process.live, open: isProcessOpen(message, item.process), interrupted: message.status === 'aborted' && item.process.interrupted }">
        <button type="button" class="process-toggle" :aria-expanded="isProcessOpen(message, item.process)" :title="t(isProcessOpen(message, item.process) ? 'ai.process.collapse' : 'ai.process.expand')" @click="toggleProcess(message, item.process)">
          <AppIcon name="chevron-right" size="xs" class="details-chevron" />
          <span class="process-title" :class="{ 'ai-think-shimmer': item.process.live }" :title="processTitle(item.process)">{{ processTitle(item.process) }}</span>
          <span v-if="item.process.live" class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
        </button>
      </div>
      <details
        v-if="item.seg.kind === 'reasoning'"
        v-show="processStepVisible(message, item)"
        class="reasoning-box"
        :class="{ live: isReasoningLive(message, segIndex), 'process-step': !!item.process }"
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
      <AiToolRunRow v-else-if="item.seg.kind === 'tool' && item.run" v-show="processStepVisible(message, item)" :class="{ 'process-step': !!item.process }" :run="item.run" :streaming="message.streaming" :open="isToolRunOpen(message, item.run)" execution-history-available @toggle="onToolRunToggle(message, item.run!, $event)" @view-execution="emit('view-execution', `${message.id}:${item.run!.id}`)" @view-knowledge="emit('view-knowledge', item.run!)" />
      <div v-else-if="item.seg.kind === 'content' && isChatContentBoundary(item.seg)" class="message-content">
        <AiWorkspaceResponse v-if="!isLiveContentSegment(message, segIndex) && message.role === 'assistant' && (workspaceTargets?.length || 0) > 1" :text="item.seg.text" :targets="workspaceTargets!" />
        <AiStreamingMarkdown
          v-else :content="item.seg.text" :streaming="isLiveContentSegment(message, segIndex)"
          :terminal-actions="terminalActions"
          @fill-code="emit('fill-code', $event)" @run-code="emit('run-code', $event)"
          @layout="handleViewportInsetChange"
        />
      </div>
      </template>
      <div v-if="!message.streaming && (message.error || message.status === 'error')" class="chat-failure" role="status">
        <div class="chat-failure-title"><AppIcon name="alert-circle" size="xs" aria-hidden="true" />{{ failureTitle(message) }}</div>
        <div v-if="message.toolRuns?.length" class="chat-failure-note">{{ t('ai.chatFailure.recordsKept') }}</div>
        <details v-if="message.failure?.detail">
          <summary><AppIcon name="chevron-right" size="xs" class="details-chevron" aria-hidden="true" />{{ t('ai.chatFailure.details') }}</summary>
          <div class="chat-failure-detail">{{ message.failure.detail }}</div>
          <div v-if="message.failure.code" class="chat-failure-detail"><code>{{ message.failure.code }}</code></div>
        </details>
      </div>
      <AiActivityStatus v-if="message.streaming" :activity="message.activity" :created-at="message.createdAt" />
      </template>
      <AiMessageFooter
        v-if="editingMessageId !== message.id && (message.role === 'user' || !message.streaming)"
        :message="message"
        :loading="!!loading"
        :latest-reply="message.id === latestReplyId"
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
      ref="timelineRef"
      class="chat-timeline"
      :class="{ expanded: timelineExpanded }"
      :aria-label="t('ai.timelineAria')"
      @mouseenter="setTimelineHovered(true)"
      @mouseleave="setTimelineHovered(false)"
      @focusin="onTimelineFocus"
      @focusout="onTimelineBlur"
    >
      <button
        v-for="turn in visibleTimelineTurns"
        :key="turn.id"
        type="button"
        class="chat-timeline-item"
        :class="{ active: turn.id === activeTurnId }"
        :aria-current="turn.id === activeTurnId ? 'true' : undefined"
        :title="t('ai.timelineTurn', { n: turn.index + 1, text: turn.preview })"
        :aria-label="t('ai.timelineTurn', { n: turn.index + 1, text: turn.preview })"
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
      :title="t('ai.jumpToLatest')"
      :aria-label="t('ai.jumpToLatest')"
      @click="toggleFollowLatest"
    >
      <AppIcon name="arrow-down" size="md" />
    </button>
  </div>
</template>

<style scoped src="./AiChatView.css"></style>
