<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AiUsage } from '../../env.d.ts'
import type { ChatItem } from '@/composables/ai/useAiChat'
import { formatMessageTime, formatMessageTimeDetail, messageDisplayTimestamp } from '@/utils/ai/messageTime'
import { formatCompactTokenCount } from '@/utils/ai/tokenCount'
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
  if (usage.totalTokens !== undefined) return t('ai.usageCompact', { n: formatCompactTokenCount(usage.totalTokens) })
  const n = (usage.promptTokens || 0) + (usage.completionTokens || 0) + (usage.reasoningTokens || 0)
  return n > 0 ? t('ai.usageCompact', { n: formatCompactTokenCount(n) }) : ''
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
