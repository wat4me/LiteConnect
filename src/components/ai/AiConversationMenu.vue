<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import AppIcon, { type AppIconName } from '../icons/AppIcon.vue'

export type AiConversationMenuItem = { id: string; label: string; icon: AppIconName; disabled?: boolean; danger?: boolean; separator?: boolean }
const props = defineProps<{ items: AiConversationMenuItem[]; active: boolean }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const open = ref(false)
const anchor = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLDivElement | null>(null)
const style = ref<Record<string, string>>({})
let anchorBounds: DOMRect | undefined
function close() { open.value = false }
function dismiss() {
  close()
  const target = anchor.value
  target?.focus({ preventScroll: true })
  void nextTick(() => {
    if (!open.value && target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true })
  })
}
function buttons() { return [...(panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])] }
watch(open, async value => {
  if (!value) return
  await nextTick()
  if (!anchor.value || !panel.value || !open.value) return
  const width = Math.min(240, innerWidth - 16)
  anchorBounds = anchor.value.getBoundingClientRect()
  const pos = placePopupNearAnchor(anchorBounds, { width, height: panel.value.scrollHeight }, { align: 'end', gap: 6 })
  style.value = { left: `${pos.left}px`, top: `${pos.top}px`, width: `${width}px`, maxHeight: `${pos.maxHeight}px` }
  await nextTick()
  if (open.value) buttons()[0]?.focus({ preventScroll: true })
})
watch(() => props.active, value => { if (!value) close() })
useOutsideDismiss(open, dismiss, () => [anchor.value, panel.value])
function select(item: AiConversationMenuItem) { if (!item.disabled) { dismiss(); emit('select', item.id) } }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); dismiss(); return }
  const rows = buttons()
  const index = rows.indexOf(document.activeElement as HTMLButtonElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length
    rows[next]?.focus()
  } else if (event.key === 'Tab') { close(); anchor.value?.focus() }
}
function scroll(event: Event) {
  if (!open.value || panel.value?.contains(event.target as Node) || !anchorBounds || !anchor.value) return
  const current = anchor.value.getBoundingClientRect()
  if (Math.abs(current.top - anchorBounds.top) > 0.5 || Math.abs(current.left - anchorBounds.left) > 0.5) close()
}
window.addEventListener('resize', close)
window.addEventListener('scroll', scroll, true)
onDeactivated(close)
onBeforeUnmount(() => { window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true) })
</script>

<template>
  <button ref="anchor" type="button" class="ui-icon-btn ui-icon-btn-sm ai-conversation-menu-trigger" :class="{ active: open }" :title="t('ai.workspace.conversationActions')" :aria-label="t('ai.workspace.conversationActions')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open" @keydown.down.prevent="open = true">
    <AppIcon name="more" size="sm" />
  </button>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="ui-menu ai-conversation-menu" :style="style" role="menu" :aria-label="t('ai.workspace.conversationActions')" @keydown="keydown">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="ui-menu-sep" role="separator" />
        <button type="button" class="ui-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" :data-action="item.id" role="menuitem" @click="select(item)"><AppIcon :name="item.icon" size="sm" /><span>{{ item.label }}</span></button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ai-conversation-menu-trigger { width: var(--icon-btn-md); height: var(--icon-btn-md); border-color: var(--workspace-line, var(--border-color)); background: var(--bg-primary); }
.ai-conversation-menu { width: 240px; }
.ai-conversation-menu .ui-menu-item { min-height: var(--control-h-sm); }
.ai-conversation-menu .ui-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
