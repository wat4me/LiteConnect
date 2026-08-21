<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiUsage } from '../../env.d.ts'
import { useMarkdownRenderer, type MarkdownBlock } from '@/composables/ai/useMarkdownRenderer'
import type { ChatItem } from '../../composables/ai/useAiChat'
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
  (e: 'edit-message', messageId: string): void
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

const markdownCache = new Map<string, { content: string; blocks: MarkdownBlock[] }>()
function parseMarkdownCached(message: ChatItem, field: 'content' | 'reasoningContent'): MarkdownBlock[] {
  const text = (message[field] as string) || ''
  const key = `${message.id}-${field}`
  const cached = markdownCache.get(key)
  if (cached && cached.content === text) return cached.blocks
  const blocks = parseMarkdown(text)
  markdownCache.set(key, { content: text, blocks })
  return blocks
}

watch(() => props.messages, (msgs) => {
  const validKeys = new Set(msgs.map((m) => `${m.id}-content`).concat(msgs.map((m) => `${m.id}-reasoningContent`)))
  for (const key of markdownCache.keys()) {
    if (!validKeys.has(key)) markdownCache.delete(key)
  }
}, { deep: false })

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

function onListScroll() {
  if (isProgrammaticScroll) {
    captureScroll()
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
        `${m.id}:${m.content.length}:${(m.reasoningContent || '').length}:${m.streaming ? 1 : 0}`,
    )
    .join('|'),
)

watch(
  [messagesSignature, () => props.loading, () => props.messages.length],
  async () => {
    if (!followLatest.value) return
    await nextTick()
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
      })
      return
    }
    restoreScroll()
    requestAnimationFrame(() => restoreScroll())
  })
})

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})

const lastAssistantId = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const m = props.messages[i]
    if (m.role === 'assistant' && !m.streaming) return m.id
  }
  return ''
})

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
    <div ref="listRef" class="chat-list" @scroll.passive="onListScroll">
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-mark" aria-hidden="true">
          <AppIcon name="ai-chat" size="xl" />
        </div>
        <div class="empty-title">{{ t('ai.emptyTitle') }}</div>
        <div class="empty-text">
          {{ hasApiConfigured ? t('ai.emptyConfigured') : t('ai.emptyNoKey') }}
        </div>
        <div class="empty-actions">
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
      >
      <div class="message-stack">
        <div v-if="!message.streaming && !loading" class="message-actions">
          <template v-if="message.role === 'user'">
            <button
              type="button"
              class="msg-action-btn"
              :title="t('ai.editMessage')"
              @click="emit('edit-message', message.id)"
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
      <div v-if="message.toolRuns?.length" class="tool-runs">
        <div
          v-for="run in message.toolRuns"
          :key="run.id"
          class="tool-run"
          :class="{ error: run.isError, pending: message.streaming && !run.content }"
        >
          <div class="tool-run-head">
            <span class="tool-run-name">{{ run.name }}</span>
            <span v-if="message.streaming && !run.content" class="tool-run-state">{{ t('ai.toolRunning') }}</span>
            <span v-else-if="run.isError" class="tool-run-state">{{ t('ai.toolFailed') }}</span>
          </div>
          <pre v-if="run.args" class="tool-run-args">{{ run.args }}</pre>
          <pre v-if="run.content" class="tool-run-out">{{ run.content }}</pre>
        </div>
      </div>
      <details v-if="message.reasoningContent" class="reasoning-box">
        <summary>{{ t('ai.reasoning') }}</summary>
        <div class="reasoning-content">
          <template v-for="(block, index) in parseMarkdownCached(message, 'reasoningContent')" :key="index">
            <div v-if="block.type === 'code'" class="code-block">
              <div class="code-block-header">
                <span class="code-language">{{ block.language || 'text' }}</span>
                <button
                  type="button"
                  class="copy-btn"
                  :title="copiedKey === `${message.id}-reasoning-code-${index}` ? t('common.copied') : t('ai.copyCode')"
                  @click="copyText(block.content, `${message.id}-reasoning-code-${index}`)"
                >
                  <AppIcon v-if="copiedKey === `${message.id}-reasoning-code-${index}`" name="check" size="sm" />
                  <AppIcon v-else name="copy" size="sm" />
                </button>
              </div>
              <pre class="markdown-code"><code>{{ block.content }}</code></pre>
            </div>
            <div v-else class="markdown-block" v-html="block.content"></div>
          </template>
        </div>
      </details>
      <div v-if="message.content || (!message.reasoningContent && message.streaming)" class="message-content">
        <template v-if="message.content">
          <template v-for="(block, index) in parseMarkdownCached(message, 'content')" :key="index">
            <div v-if="block.type === 'code'" class="code-block">
              <div class="code-block-header">
                <span class="code-language">{{ block.language || 'text' }}</span>
                <div class="code-actions">
                  <button type="button" class="code-action-btn" :title="t('ai.fillTerminal')" @click="emit('fill-code', block.content)">{{ t('ai.fill') }}</button>
                  <button type="button" class="code-action-btn primary" :title="t('ai.runTerminal')" @click="emit('run-code', block.content)">{{ t('ai.run') }}</button>
                  <button
                    type="button"
                    class="copy-btn"
                    :title="copiedKey === `${message.id}-code-${index}` ? t('common.copied') : t('ai.copyCode')"
                    @click="copyText(block.content, `${message.id}-code-${index}`)"
                  >
                    <AppIcon v-if="copiedKey === `${message.id}-code-${index}`" name="check" size="sm" />
                    <AppIcon v-else name="copy" size="sm" />
                  </button>
                </div>
              </div>
              <pre class="markdown-code"><code>{{ block.content }}</code></pre>
            </div>
            <div v-else class="markdown-block" v-html="block.content"></div>
          </template>
        </template>
        <span v-else class="thinking">
          <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          {{ t('ai.thinking') }}
        </span>
      </div>
      <div
        v-if="message.id === lastAssistantId && formatUsage(message.usage)"
        class="usage-line"
        :title="formatUsageDetail(message.usage)"
      >
        {{ formatUsage(message.usage) }}
      </div>
      </div>
    </div>
    </div>
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

.empty-state {
  margin: auto 0;
  color: var(--text-secondary);
  text-align: center;
  padding: 28px 12px;
}

.empty-mark {
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--accent-bg);
  color: var(--accent);
}

.empty-title {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.empty-text {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
}

.empty-actions {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  gap: 8px;
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

.message-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  order: 2;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.chat-row:hover .message-actions,
.chat-row:focus-within .message-actions {
  opacity: 1;
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

@keyframes ai-think {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
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
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
  padding: 6px 8px;
  font-size: 11px;
}

.tool-run.error {
  border-color: color-mix(in srgb, var(--danger, #f85149) 45%, var(--border-color));
}

.tool-run.pending {
  opacity: 0.85;
}

.tool-run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 650;
  color: var(--text-primary);
}

.tool-run-state {
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-run-args,
.tool-run-out {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.4;
  max-height: 180px;
  overflow: auto;
}

.reasoning-box {
  width: fit-content;
  max-width: 100%;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 55%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
}

.reasoning-box summary {
  padding: 4px 10px;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 600;
  list-style: none;
}

.reasoning-box summary::-webkit-details-marker {
  display: none;
}

.reasoning-content {
  padding: 0 8px 8px;
}

.usage-line {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.75;
  order: 3;
}

.code-block {
  border-radius: 8px;
}
</style>
