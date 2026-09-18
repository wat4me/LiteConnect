<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

defineProps<{
  searchQuery: string
  caseSensitive: boolean
  useRegex: boolean
  matchIndex: number
  matchCount: number
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'update:caseSensitive', value: boolean): void
  (e: 'update:useRegex', value: boolean): void
  (e: 'set-input-ref', el: HTMLInputElement | null): void
  (e: 'input'): void
  (e: 'keydown', event: KeyboardEvent): void
  (e: 'find-previous'): void
  (e: 'find-next'): void
  (e: 're-run'): void
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="search-bar" role="search">
    <AppIcon name="search" size="sm" />
    <input
      :ref="(el) => emit('set-input-ref', el as HTMLInputElement | null)"
      :value="searchQuery"
      class="ui-input ui-input-sm ui-input-mono search-input"
      :placeholder="t('terminal.searchPlaceholder')"
      @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value); emit('input')"
      @keydown="emit('keydown', $event)"
    />
    <button type="button" class="search-nav-btn" :title="t('terminal.searchPrev')" @click="emit('find-previous')">↑</button>
    <button type="button" class="search-nav-btn" :title="t('terminal.searchNext')" @click="emit('find-next')">↓</button>
    <span v-if="matchCount > 0" class="search-count">{{ matchIndex }}/{{ matchCount }}</span>
    <span v-else-if="searchQuery" class="search-count muted">0</span>
    <label class="search-opt" :title="t('terminal.searchCaseSensitive')">
      <input
        type="checkbox"
        :checked="caseSensitive"
        @change="emit('update:caseSensitive', ($event.target as HTMLInputElement).checked); emit('re-run')"
      />
      Aa
    </label>
    <label class="search-opt" :title="t('terminal.searchRegex')">
      <input
        type="checkbox"
        :checked="useRegex"
        @change="emit('update:useRegex', ($event.target as HTMLInputElement).checked); emit('re-run')"
      />
      .*
    </label>
    <span class="search-hint">{{ t('terminal.searchHint') }}</span>
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('terminal.searchClose')" @click="emit('close')">
      <AppIcon name="close" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.search-bar svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  width: auto;
  min-width: 0;
}

.search-nav-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary, transparent);
  color: var(--text-secondary);
  border-radius: 4px;
  width: 24px;
  height: 22px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.search-nav-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.search-count {
  font-size: 11px;
  color: var(--text-primary);
  min-width: 36px;
  text-align: center;
  flex-shrink: 0;
}

.search-count.muted {
  color: var(--text-secondary);
  opacity: 0.7;
}

.search-opt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}

.search-opt input {
  margin: 0;
  cursor: pointer;
}

.search-hint {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  opacity: 0.6;
}

</style>
