<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps<{
  items: { id: string; title: string; updatedAt: number }[]
  disabled?: boolean
}>()

const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
</script>

<template>
  <section v-if="items.length" class="ai-recent-conversations">
    <h4>{{ t('connections.aiDraftResume') }}</h4>
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="ai-recent-conversation"
      :disabled="disabled"
      :title="item.title"
      @click="emit('select', item.id)"
    >
      <AppIcon name="history" size="sm" aria-hidden="true" />
      <span class="recent-title">{{ item.title }}</span>
      <span class="recent-time">{{ new Date(item.updatedAt).toLocaleDateString() }}</span>
    </button>
  </section>
</template>

<style scoped>
.ai-recent-conversations { width: min(100%, 420px); margin-top: 16px; text-align: left; }
.ai-recent-conversations h4 { margin: 0 0 6px 2px; color: var(--text-secondary); font-size: var(--font-ui-sm); font-weight: 600; }
.ai-recent-conversation {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-ui-sm);
  text-align: left;
  cursor: pointer;
}
.ai-recent-conversation:hover:not(:disabled) { background: var(--tab-hover-surface); }
.ai-recent-conversation:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ai-recent-conversation:disabled { opacity: .55; cursor: not-allowed; }
.ai-recent-conversation :deep(.app-icon) { color: var(--text-secondary); flex-shrink: 0; }
.recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recent-time { flex-shrink: 0; color: var(--text-secondary); font-size: var(--font-caption); }
</style>
