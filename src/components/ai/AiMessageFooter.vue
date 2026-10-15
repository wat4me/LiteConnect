<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AiUsage } from '../../env.d.ts'
import type { ChatItem } from '@/domain/ai/chat'
import { formatMessageTime, formatMessageTimeDetail, messageDisplayTimestamp } from '@/utils/ai/messageTime'
import { formatCompactTokenCount } from '@/utils/ai/tokenCount'
import { normalizeAiUsage } from '@shared/aiUsage'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  message: ChatItem
  loading: boolean
  lastAssistantId: string
  lastUserMessageId: string
  copiedKey: string
}>()

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'delete'): void
  (e: 'retry'): void
  (e: 'regenerate'): void
  (e: 'copy'): void
}>()

const { t } = useI18n()

function formatUsageDetail(raw?: AiUsage): string {
  const usage = normalizeAiUsage(raw)
  if (!usage) return ''
  const n = (count: number | undefined) => count ?? t('ai.usageNotReported')
  const parts = [
    t('ai.usageInput', { n: n(usage.promptTokens) }),
    t('ai.usageCachedInput', { n: n(usage.cachedPromptTokens) }),
    t('ai.usageUncachedInput', { n: n(usage.uncachedPromptTokens) }),
    ...(usage.cacheCreationPromptTokens !== undefined ? [t('ai.usageCacheCreationDetail', { n: usage.cacheCreationPromptTokens })] : []),
    t('ai.usageOutput', { n: n(usage.completionTokens) }),
    ...(usage.reasoningTokens !== undefined ? [t('ai.usageReasoningIncluded', { n: usage.reasoningTokens })] : []),
    t('ai.usageTotal', { n: n(usage.totalTokens) }),
    ...(usage.requestCount ? [t('ai.usageRequests', { n: usage.requestCount })] : []),
    t('ai.usageAccountingHint'),
  ]
  if (usage.usageIncomplete) parts.push(t('ai.usagePartialHint'))
  if (usage.cacheUsageIncomplete) parts.push(t('ai.usageCachePartialHint'))
  return parts.join('\n')
}

function formatUsage(raw?: AiUsage): string {
  const usage = normalizeAiUsage(raw)
  if (!usage) return ''
  const parts: string[] = []
  if (usage.totalTokens !== undefined) parts.push(t('ai.usageCompact', { n: formatCompactTokenCount(usage.totalTokens) }))
  else parts.push(t(props.message.streaming ? 'ai.usagePending' : 'ai.usageUnavailable'))
  if (usage.cachedPromptTokens !== undefined) parts.push(t('ai.usageCachedCompact', { n: formatCompactTokenCount(usage.cachedPromptTokens) }))
  if (usage.uncachedPromptTokens !== undefined) parts.push(t('ai.usageUncachedCompact', { n: formatCompactTokenCount(usage.uncachedPromptTokens) }))
  if (usage.cacheCreationPromptTokens) parts.push(t('ai.usageCacheCreationCompact', { n: formatCompactTokenCount(usage.cacheCreationPromptTokens) }))
  if (usage.cachedPromptTokens === undefined && usage.uncachedPromptTokens === undefined) parts.push(t('ai.usageCacheUnavailable'))
  if (usage.completionTokens !== undefined) parts.push(t('ai.usageOutput', { n: formatCompactTokenCount(usage.completionTokens) }))
  if (usage.usageIncomplete) parts.push(t('ai.usagePartial'))
  else if (usage.cacheUsageIncomplete && (usage.cachedPromptTokens !== undefined || usage.uncachedPromptTokens !== undefined)) parts.push(t('ai.usageCachePartial'))
  return parts.join(' · ')
}

function messageTimeText(): string {
  const timestamp = messageDisplayTimestamp(props.message)
  return timestamp ? formatMessageTime(timestamp) : ''
}

function messageTimeTitle(): string {
  const timestamp = messageDisplayTimestamp(props.message)
  if (!timestamp) return ''
  const time = formatMessageTimeDetail(timestamp)
  return props.message.role === 'user' ? t('ai.sentAt', { time }) : t('ai.replyCompletedAt', { time })
}

function messageTimeIso(): string {
  const timestamp = messageDisplayTimestamp(props.message)
  return timestamp ? new Date(timestamp).toISOString() : ''
}
</script>

<template>
  <div class="message-footer">
    <time
      v-if="messageTimeText()"
      class="message-time"
      :datetime="messageTimeIso()"
      :title="messageTimeTitle()"
      :aria-label="messageTimeTitle()"
    >{{ messageTimeText() }}</time>
    <span v-if="message.role === 'assistant' && message.status === 'aborted'" class="interrupted-line">
      {{ t('ai.requestInterrupted') }}
    </span>
    <span
      v-if="message.role === 'assistant' && formatUsage(message.usage)"
      class="usage-line"
      :title="formatUsageDetail(message.usage)"
      :aria-label="formatUsageDetail(message.usage)"
      tabindex="0"
    >{{ formatUsage(message.usage) }}</span>
    <div v-if="!loading && !message.streaming" class="message-actions">
      <template v-if="message.role === 'user'">
        <button
          v-if="message.id === lastUserMessageId"
          type="button"
          class="msg-action-btn"
          :title="t('ai.editMessage')"
          @click="emit('edit')"
        ><AppIcon name="edit" size="xs" /></button>
        <button type="button" class="msg-action-btn" :title="t('ai.deleteMessage')" @click="emit('delete')">
          <AppIcon name="delete" size="xs" />
        </button>
      </template>
      <template v-else>
        <button
          v-if="message.id === lastAssistantId && (message.error || message.status === 'aborted')"
          type="button"
          class="msg-action-btn"
          :title="t('ai.retry')"
          @click="emit('retry')"
        ><AppIcon name="refresh" size="xs" /></button>
        <button
          v-else-if="message.id === lastAssistantId && message.content"
          type="button"
          class="msg-action-btn"
          :title="t('ai.regenerate')"
          @click="emit('regenerate')"
        ><AppIcon name="refresh" size="xs" /></button>
        <button
          v-if="message.content"
          type="button"
          class="msg-action-btn"
          :title="copiedKey === `${message.id}-message` ? t('common.copied') : t('ai.copyReply')"
          @click="emit('copy')"
        >
          <AppIcon v-if="copiedKey === `${message.id}-message`" name="check" size="xs" />
          <AppIcon v-else name="copy" size="xs" />
        </button>
        <button type="button" class="msg-action-btn" :title="t('ai.deleteMessage')" @click="emit('delete')">
          <AppIcon name="delete" size="xs" />
        </button>
      </template>
    </div>
  </div>
</template>
