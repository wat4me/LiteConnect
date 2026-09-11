<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import AppIcon from '../icons/AppIcon.vue'
const props = defineProps<{
  title: string; label: string; shortLabel?: string; icon: 'shield'; disabled?: boolean
  value: string; options: Array<{ value: string; label: string; description: string }>
}>()
const emit = defineEmits<{ change: [value: string] }>()
const open = ref(false)
const anchor = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({})
function close() { open.value = false }
function dismiss() { close(); anchor.value?.focus() }
async function position() {
  await nextTick()
  if (!anchor.value || !panel.value) return
  const width = Math.min(300, window.innerWidth - 16)
  panel.value.style.width = `${width}px`
  const pos = placePopupNearAnchor(anchor.value.getBoundingClientRect(), { width, height: panel.value.offsetHeight }, { align: 'end', prefer: 'above', gap: 6 })
  style.value = { left: `${pos.left}px`, top: `${pos.top}px`, width: `${width}px`, maxHeight: `${pos.maxHeight || 360}px` }
}
watch(open, async value => {
  if (value) { await position(); panel.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }
})
watch(() => props.disabled, value => { if (value) close() })
useOutsideDismiss(open, dismiss, () => [anchor.value, panel.value])
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); dismiss(); return }
  const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }
  if (event.key === 'Tab') close()
}
function choose(value: string) { emit('change', value); dismiss() }
function onScroll(event: Event) { if (!panel.value?.contains(event.target as Node)) close() }
window.addEventListener('resize', close)
window.addEventListener('scroll', onScroll, true)
onDeactivated(close)
onBeforeUnmount(() => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true) })
</script>
<template>
  <span class="selector-wrap" :title="title">
    <button ref="anchor" type="button" class="composer-selector" :class="{ active: open }" :disabled="disabled" :aria-label="`${title}: ${label}`" aria-haspopup="menu" :aria-expanded="open" @click="open = !open" @keydown.down.prevent="open = true">
      <AppIcon :name="icon" size="sm" /><span class="selector-label">{{ label }}</span><span v-if="shortLabel" class="selector-short">{{ shortLabel }}</span><AppIcon name="chevron-down" size="xs" />
    </button>
  </span>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="composer-selector-menu" :style="style" role="menu" :aria-label="title" @keydown="keydown">
      <div class="selector-title">{{ title }}</div>
      <button v-for="option in options" :key="option.value" type="button" role="menuitemradio" :aria-checked="value === option.value" @click="choose(option.value)">
        <span class="option-dot">{{ value === option.value ? '●' : '○' }}</span><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
      </button>
    </div>
  </Teleport>
</template>
<style scoped>
.selector-wrap { display: inline-flex; min-width: 0; }
.composer-selector { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 34px; padding: 0 6px; border: 1px solid transparent; border-radius: 8px; color: var(--text-secondary); background: transparent; font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.composer-selector:hover:not(:disabled), .composer-selector.active { background: var(--hover-bg); color: var(--text-primary); border-color: var(--border-color); }
.composer-selector:disabled { opacity: .45; cursor: not-allowed; }
.composer-selector:focus-visible, .composer-selector-menu button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.selector-short { display: none; }
.composer-selector-menu { position: fixed; z-index: 10001; padding: 6px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 8px 24px #0003; overflow-y: auto; box-sizing: border-box; }
.selector-title { padding: 6px 8px; font-size: 11px; color: var(--text-secondary); }
.composer-selector-menu button { display: flex; width: 100%; gap: 8px; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.composer-selector-menu button:hover { background: var(--hover-bg); }
.composer-selector-menu button[aria-checked="true"] { background: var(--accent-bg); color: var(--accent); }
.composer-selector-menu strong { font-size: 12px; font-weight: 500; }
.composer-selector-menu small { display: block; margin-top: 4px; font-size: 11px; line-height: 1.5; color: var(--text-secondary); }
@container ai-composer (max-width: 360px) { .selector-label:has(+ .selector-short) { display: none; } .selector-short { display: inline; } .composer-selector { padding: 0 4px; gap: 3px; } }
</style>
