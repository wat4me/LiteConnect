<script setup lang="ts">
import { useI18n } from 'vue-i18n'

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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      :ref="(el) => emit('set-input-ref', el as HTMLInputElement | null)"
      :value="searchQuery"
      class="search-input"
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
    <button class="search-close" :title="t('terminal.searchClose')" @click="emit('close')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
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
  padding: 4px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  outline: none;
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
  border-color: var(--accent, #58a6ff);
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

.search-input:focus {
  border-color: var(--accent);
}

.search-hint {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  opacity: 0.6;
}

.search-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.search-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}
</style>
