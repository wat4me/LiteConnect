<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch, type CSSProperties } from 'vue'
import AppIcon, { type AppIconName } from '../icons/AppIcon.vue'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'

const props = withDefaults(defineProps<{
  label: string
  ariaLabel?: string
  modelValue?: string
  items: { id: string; label: string; title?: string; disabled?: boolean; icon?: AppIconName; color?: string }[]
  align?: 'left' | 'right'
  triggerClass?: string
  menuClass?: string
  iconOnly?: boolean
  triggerIcon?: AppIconName
  showChevron?: boolean
  teleport?: boolean
}>(), { align: 'left' })
const emit = defineEmits<{ (e: 'select', id: string): void }>()
const menuId = useId()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<CSSProperties>({})

function positionMenu() {
  if (!props.teleport || !open.value || !triggerRef.value || !menuRef.value) return
  const anchor = triggerRef.value.getBoundingClientRect()
  const menu = menuRef.value.getBoundingClientRect()
  const position = placePopupNearAnchor(anchor, menu, { align: props.align === 'right' ? 'end' : 'start', gap: 6 })
  menuStyle.value = { position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, right: 'auto', maxHeight: `${position.maxHeight}px`, overflowY: 'auto' }
}
watch(open, async value => {
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
  if (value && props.teleport) {
    await nextTick()
    if (!open.value) return
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
})

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
  positionMenu()
  if (props.teleport) await nextTick()
  if (!open.value) return
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
}, () => [rootRef.value, menuRef.value])
</script>

<template>
  <div ref="rootRef" class="toolbar-dropdown" :data-value="modelValue">
    <button
      ref="triggerRef" type="button" class="dropdown-trigger" :class="[triggerClass, iconOnly ? 'ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm icon-only' : 'ui-btn', { 'with-chevron': iconOnly && showChevron }]"
      :title="ariaLabel ?? label"
      :aria-label="ariaLabel ?? label" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
      @click="toggle" @keydown.down.stop.prevent="show()" @keydown.up.stop.prevent="show(true)"
    >
      <template v-if="iconOnly">
        <AppIcon :name="triggerIcon ?? 'more'" size="md" />
        <AppIcon v-if="showChevron" name="chevron-down" size="xs" />
      </template>
      <template v-else>
        <span class="dropdown-label">{{ label }}</span>
        <AppIcon name="chevron-down" size="xs" />
      </template>
    </button>
    <Teleport to="body" :disabled="!teleport">
    <div
      v-if="open" :id="menuId" ref="menuRef" class="ui-menu dropdown-menu"
      :class="[menuClass, { 'align-right': align === 'right', 'ui-menu-anchored': !teleport, teleported: teleport }]"
      :style="teleport ? menuStyle : undefined"
      role="menu" :aria-label="ariaLabel ?? label" @keydown="onMenuKeydown"
    >
      <button
        v-for="item in items" :key="item.id" type="button" class="ui-menu-item dropdown-item"
        :class="{ selected: modelValue === item.id }" :data-value="item.id" :disabled="item.disabled"
        :title="item.title ?? item.label" :role="modelValue === undefined ? 'menuitem' : 'menuitemradio'"
        :aria-checked="modelValue === undefined ? undefined : modelValue === item.id" tabindex="-1"
        @click="select(item.id)"
      >
        <span class="dropdown-item-label">
          <span v-if="item.color" class="dropdown-item-swatch" :style="{ background: item.color }" aria-hidden="true"></span>
          <AppIcon v-if="item.icon" :name="item.icon" size="sm" />
          <span class="dropdown-label">{{ item.label }}</span>
        </span>
        <span v-if="modelValue !== undefined" class="dropdown-check">
          <AppIcon v-if="modelValue === item.id" name="check" size="sm" />
        </span>
      </button>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.toolbar-dropdown { position: relative; flex-shrink: 0; min-width: 0; }
.dropdown-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; font-weight: 500; }
.dropdown-trigger.icon-only { width: var(--icon-btn-sm); padding: 0; justify-content: center; }
.dropdown-trigger.icon-only.with-chevron { width: calc(var(--icon-btn-sm) + var(--icon-xs) + 4px); gap: 2px; }
.dropdown-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dropdown-menu { top: calc(100% + 6px); left: 0; min-width: max(170px, 100%); max-width: calc(100vw - 32px); }
.dropdown-menu.align-right { left: auto; right: 0; }
.dropdown-menu.teleported { min-width: 170px; }
.dropdown-item { justify-content: space-between; }
.dropdown-item-label { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dropdown-item-swatch { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.dropdown-item.selected { background: var(--accent-bg); color: var(--text-primary); }
.dropdown-check { display: inline-flex; width: var(--icon-sm); flex-shrink: 0; color: var(--accent); }
.dropdown-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
