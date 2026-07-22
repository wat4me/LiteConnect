<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AiHistorySummary } from '../env.d.ts'
import AppIcon from './icons/AppIcon.vue'

defineProps<{
  items: AiHistorySummary[]
}>()

const emit = defineEmits<{
  (e: 'select', sessionId: string): void
  (e: 'close'): void
  (e: 'clear-all'): void
  (e: 'delete', sessionId: string): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="history-box">
    <div class="history-header">
      <span class="history-header-title">{{ t('ai.history') }}</span>
      <div class="history-header-actions">
        <button
          v-if="items.length > 0"
          type="button"
          class="history-action-btn"
          :title="t('ai.clearAllHistory')"
          @click="emit('clear-all')"
        >
          {{ t('ai.clear') }}
        </button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.closeHistory')" @click="emit('close')">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>
    <div v-if="items.length === 0" class="history-empty">{{ t('ai.emptyHistory') }}</div>
    <div
      v-for="item in items"
      :key="item.sessionId"
      class="history-item"
    >
      <button type="button" class="history-item-main" @click="emit('select', item.sessionId)">
        <span class="history-title">{{ item.title }}</span>
        <span class="history-meta">{{ t('ai.messageCount', { count: item.messageCount, time: new Date(item.updatedAt).toLocaleString() }) }}</span>
      </button>
      <button
        type="button"
        class="history-delete-btn"
        :title="t('ai.deleteHistoryItem')"
        @click.stop="emit('delete', item.sessionId)"
      >
        <AppIcon name="delete" :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.history-box {
  max-height: 220px;
  overflow-y: auto;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  padding: 0 2px;
}

.history-header-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.history-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-action-btn {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.history-action-btn:hover {
  color: var(--danger, #e54d42);
  border-color: color-mix(in srgb, var(--danger, #e54d42) 40%, var(--border-color));
  background: color-mix(in srgb, var(--danger, #e54d42) 10%, transparent);
}

.history-empty {
  padding: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.history-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  border-radius: 6px;
}

.history-item:hover {
  background: var(--hover-bg);
}

.history-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.history-delete-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: 4px;
  margin-right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0.55;
}

.history-item:hover .history-delete-btn {
  opacity: 1;
}

.history-delete-btn:hover {
  color: var(--danger, #e54d42);
  background: color-mix(in srgb, var(--danger, #e54d42) 12%, transparent);
}

.history-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.history-meta {
  font-size: 10px;
  color: var(--text-secondary);
}
</style>
