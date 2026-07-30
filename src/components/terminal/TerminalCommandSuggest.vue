<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ShellSuggestItem } from '@/utils/terminal/shellCommandSuggest'

const props = defineProps<{
  visible: boolean
  items: ShellSuggestItem[]
  activeIndex: number
  /** Position relative to terminal wrapper (px) */
  left?: number
  top?: number
  /** Prefer opening upward from cursor */
  placeAbove?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:activeIndex', v: number): void
  (e: 'pick', item: ShellSuggestItem): void
}>()

const { t } = useI18n()
const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.activeIndex,
  async (idx) => {
    await nextTick()
    const el = listRef.value?.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  },
)

function subtitle(item: ShellSuggestItem): string {
  if (item.source === 'history') return ''
  if (item.source === 'flag') {
    if (item.descKey) return t(item.descKey)
    return item.subtitle || ''
  }
  if (item.descKey) return t(item.descKey)
  return item.subtitle || ''
}
</script>

<template>
  <div
    v-if="visible && items.length > 0"
    class="cmd-suggest"
    :class="{ 'place-above': placeAbove }"
    role="listbox"
    :aria-label="t('shellSuggest.aria')"
    :style="{ left: `${left ?? 12}px`, top: `${top ?? 12}px` }"
  >
    <div ref="listRef" class="cmd-suggest-list">
      <button
        v-for="(item, idx) in items"
        :key="item.id"
        type="button"
        class="cmd-suggest-item"
        :class="[item.source, { active: idx === activeIndex }]"
        :data-idx="idx"
        role="option"
        :aria-selected="idx === activeIndex"
        :title="item.source === 'history' ? item.command : undefined"
        @mouseenter="emit('update:activeIndex', idx)"
        @mousedown.prevent="emit('pick', item)"
      >
        <code class="title">{{ item.title }}</code>
        <span v-if="subtitle(item)" class="sub">{{ subtitle(item) }}</span>
        <span v-if="idx === activeIndex" class="kbd-hint">{{ t('shellSuggest.selectHint') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cmd-suggest {
  position: absolute;
  z-index: 50;
  width: min(440px, calc(100% - 16px));
  max-height: min(220px, 42%);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #252526);
  border: 1px solid var(--border-color, #3c3c3c);
  border-radius: 6px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  pointer-events: auto;
  transform: translateY(0);
}

.cmd-suggest.place-above {
  transform: translateY(-100%);
}

.cmd-suggest-list {
  overflow-y: auto;
  flex: 1;
  padding: 2px;
}

.cmd-suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 24px;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  color: inherit;
  overflow: hidden;
}

.cmd-suggest-item.active,
.cmd-suggest-item:hover {
  background: var(--accent-bg, rgba(74, 158, 255, 0.18));
}

.title {
  flex-shrink: 1;
  min-width: 0;
  max-width: 55%;
  font-size: 12px;
  line-height: 16px;
  font-family: ui-monospace, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* history = warm amber; parameter hints = cool accent */
.cmd-suggest-item.history .title {
  color: #e6a23c;
}

.cmd-suggest-item.flag .title {
  color: var(--accent, #4a9eff);
}

.sub {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-secondary, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kbd-hint {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 10px;
  line-height: 14px;
  color: var(--text-secondary, #999);
  opacity: 0.85;
  white-space: nowrap;
  padding-left: 8px;
}
</style>
