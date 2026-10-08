<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import AppIcon from '../icons/AppIcon.vue'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

const props = withDefaults(defineProps<{
  label: string
  ariaLabel?: string
  modelValue?: string
  items: { id: string; label: string; title?: string; disabled?: boolean }[]
  align?: 'left' | 'right'
  triggerClass?: string
  menuClass?: string
}>(), { align: 'left' })
const emit = defineEmits<{ (e: 'select', id: string): void }>()
const menuId = useId()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

function enabledButtons() {
  return Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
}
async function close(restoreFocus = false) {
  open.value = false
  await nextTick()
  if (restoreFocus) triggerRef.value?.focus()
}
async function show(last = false) {
  open.value = true
  await nextTick()
  const buttons = enabledButtons()
  const selected = buttons.find(button => button.dataset.value === props.modelValue)
  ;(last ? buttons.at(-1) : selected ?? buttons[0])?.focus()
}
function toggle() {
  if (open.value) void close()
  else void show()
}
async function select(id: string) {
  emit('select', id)
  await close()
  if (document.activeElement === document.body) triggerRef.value?.focus()
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void close(true)
    return
  }
  const buttons = enabledButtons()
  if (!buttons.length) return
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let next: number
  if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
  else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = buttons.length - 1
  else return
  event.preventDefault()
  event.stopPropagation()
  buttons[next]?.focus()
}
useOutsideDismiss(open, async () => {
  const focusWasInMenu = menuRef.value?.contains(document.activeElement)
  await close()
  if (focusWasInMenu && document.activeElement === document.body) triggerRef.value?.focus()
}, () => [rootRef.value])
</script>

<template>
  <div ref="rootRef" class="toolbar-dropdown" :data-value="modelValue">
    <button
      ref="triggerRef" type="button" class="ui-btn dropdown-trigger" :class="triggerClass"
      :aria-label="ariaLabel ?? label" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
      @click="toggle" @keydown.down.stop.prevent="show()" @keydown.up.stop.prevent="show(true)"
    >
      <span class="dropdown-label">{{ label }}</span>
      <AppIcon name="chevron-down" size="xs" />
    </button>
    <div
      v-if="open" :id="menuId" ref="menuRef" class="ui-menu ui-menu-anchored dropdown-menu"
      :class="[menuClass, { 'align-right': align === 'right' }]"
      role="menu" :aria-label="ariaLabel ?? label" @keydown="onMenuKeydown"
    >
      <button
        v-for="item in items" :key="item.id" type="button" class="ui-menu-item dropdown-item"
        :class="{ selected: modelValue === item.id }" :data-value="item.id" :disabled="item.disabled"
        :title="item.title" :role="modelValue === undefined ? 'menuitem' : 'menuitemradio'"
        :aria-checked="modelValue === undefined ? undefined : modelValue === item.id" tabindex="-1"
        @click="select(item.id)"
      >
        <span class="dropdown-label">{{ item.label }}</span>
        <span v-if="modelValue !== undefined" class="dropdown-check">
          <AppIcon v-if="modelValue === item.id" name="check" size="sm" />
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-dropdown { position: relative; flex-shrink: 0; min-width: 0; }
.dropdown-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; font-weight: 500; }
.dropdown-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dropdown-menu { top: calc(100% + 6px); left: 0; min-width: max(170px, 100%); max-width: calc(100vw - 32px); }
.dropdown-menu.align-right { left: auto; right: 0; }
.dropdown-item { justify-content: space-between; }
.dropdown-item.selected { background: var(--accent-bg); color: var(--text-primary); }
.dropdown-check { display: inline-flex; width: var(--icon-sm); flex-shrink: 0; color: var(--accent); }
.dropdown-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
