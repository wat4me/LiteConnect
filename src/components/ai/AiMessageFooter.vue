<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ChatItem } from '@/domain/ai/chat'
import { formatMessageTime, formatMessageTimeDetail, messageDisplayTimestamp } from '@/utils/ai/messageTime'
import AiMessageUsage from './AiMessageUsage.vue'
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
    <AiMessageUsage v-if="message.role === 'assistant' && message.usage" :usage="message.usage" />
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
