<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiUsage } from '../env.d.ts'
import { useMarkdownRenderer, type MarkdownBlock } from '../composables/useMarkdownRenderer'
import type { ChatItem } from '../composables/useAiChat'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps<{
  messages: ChatItem[]
  hasApiConfigured: boolean
}>()

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'fill-code', code: string): void
  (e: 'run-code', code: string): void
}>()

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

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

function formatUsage(usage?: AiUsage): string {
  if (!usage) return ''
  const parts: string[] = []
  if (usage.promptTokens !== undefined) parts.push(t('ai.usageInput', { n: usage.promptTokens }))
  if (usage.completionTokens !== undefined) parts.push(t('ai.usageOutput', { n: usage.completionTokens }))
  if (usage.reasoningTokens !== undefined) parts.push(t('ai.usageReasoning', { n: usage.reasoningTokens }))
  if (usage.totalTokens !== undefined) parts.push(t('ai.usageTotal', { n: usage.totalTokens }))
  return parts.join(' · ')
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
  <div class="chat-list">
    <div v-if="messages.length === 0" class="empty-state">
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
    </div>
    <div
      v-for="message in messages"
      :key="message.id"
      class="chat-message"
      :class="[message.role, { error: message.error }]"
    >
      <div class="message-role">{{ message.role === 'user' ? t('ai.roleYou') : t('ai.roleAi') }}</div>
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
                  <AppIcon v-if="copiedKey === `${message.id}-reasoning-code-${index}`" name="check" :size="14" />
                  <AppIcon v-else name="copy" :size="14" />
                </button>
              </div>
              <pre class="markdown-code"><code>{{ block.content }}</code></pre>
            </div>
            <div v-else class="markdown-block" v-html="block.content"></div>
          </template>
        </div>
      </details>
      <div v-if="message.content || (!message.reasoningContent && message.streaming)" class="message-content">
        <button
          v-if="message.content && message.role === 'assistant'"
          type="button"
          class="message-copy-btn"
          :title="copiedKey === `${message.id}-message` ? t('common.copied') : t('ai.copyReply')"
          @click="copyText(message.content, `${message.id}-message`)"
        >
          <AppIcon v-if="copiedKey === `${message.id}-message`" name="check" :size="14" />
          <AppIcon v-else name="copy" :size="14" />
        </button>
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
                    <AppIcon v-if="copiedKey === `${message.id}-code-${index}`" name="check" :size="14" />
                    <AppIcon v-else name="copy" :size="14" />
                  </button>
                </div>
              </div>
              <pre class="markdown-code"><code>{{ block.content }}</code></pre>
            </div>
            <div v-else class="markdown-block" v-html="block.content"></div>
          </template>
        </template>
        <span v-else>{{ t('ai.thinking') }}</span>
      </div>
      <div v-if="formatUsage(message.usage)" class="usage-line">
        Token: {{ formatUsage(message.usage) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty-state {
  margin: auto 0;
  color: var(--text-secondary);
  text-align: center;
  padding: 16px 8px;
}

.empty-title {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 700;
}

.empty-text {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
}

.empty-actions {
  margin-top: 12px;
  display: flex;
  justify-content: center;
  gap: 8px;
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

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-message.user {
  align-items: flex-end;
}

.message-role {
  font-size: 10px;
  color: var(--text-secondary);
}

.message-content {
  position: relative;
  max-width: 100%;
  word-break: break-word;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
}

.chat-message.assistant .message-content {
  padding-right: 38px;
}

.chat-message.user .message-content {
  background: var(--accent-bg);
  border-color: var(--accent);
}

.chat-message.error .message-content {
  border-color: var(--danger);
  color: var(--danger);
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

.reasoning-box {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 11px;
}

.reasoning-box summary {
  padding: 6px 8px;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 600;
}

.reasoning-content {
  padding: 0 8px 8px;
}

.usage-line {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.8;
}
</style>
