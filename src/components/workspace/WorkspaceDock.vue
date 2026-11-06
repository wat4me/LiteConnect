<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type ComponentPublicInstance, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { defaultWorkspaceLayout, isWorkspaceEdge, isWorkspacePanel, isWorkspaceTool, moveWorkspaceTool, WORKSPACE_EDGES, WORKSPACE_TOOLS, workspacePanelEdge, workspaceSize,
  type SshWorkspaceLayout, type WorkspaceEdge, type WorkspacePanel, type WorkspaceTool } from '@shared/workspaceLayout'
import { fitFixedElement } from '@/utils/shared/popupPosition'
import LeftToolbar from './LeftToolbar.vue'
import AppIcon from '../icons/AppIcon.vue'
import type { SplitMode } from '@/domain/terminal/types'

const props = defineProps<{
  layout: SshWorkspaceLayout; ready: boolean; error: boolean; saving: boolean
  active: Record<WorkspacePanel, boolean>; available: WorkspaceTool[]
  toolbar: InstanceType<typeof LeftToolbar>['$props']
  splitMode?: SplitMode
}>()
const emit = defineEmits<{
  (event: 'toggle', id: WorkspaceTool): void
  (event: 'change', layout: SshWorkspaceLayout): void
  (event: 'retry'): void
  (event: 'single-panel-mode', single: boolean): void
}>()
const { t } = useI18n()
const root = ref<HTMLElement>(), canvas = ref<HTMLElement>(), menuElement = ref<HTMLElement>()
const width = ref(1100), height = ref(800), canvasWidth = ref(1060)
const bodies = reactive<Partial<Record<WorkspaceEdge, HTMLElement>>>({})
const mounted = ref(false)
type ToolDropTarget = {
  edge: WorkspaceEdge
  before?: WorkspaceTool
  marker?: { id: WorkspaceTool; after: boolean }
}
const dragging = ref<WorkspaceTool>(), dropTarget = ref<ToolDropTarget>()
const resizeDraft = ref<{ edge: WorkspaceEdge; size: number }>()
const menu = ref<{ id?: WorkspaceTool; x: number; y: number; trigger: HTMLElement | null }>()
let observer: ResizeObserver | undefined
let stopResize: ((commit?: boolean) => void) | undefined
const labels: Record<WorkspaceTool, string> = { ai: 'toolbar.ai', files: 'toolbar.sftpAria', monitor: 'toolbar.monitor', batch: 'toolbar.batch', sync: 'terminal.syncTitle', snippets: 'toolbar.snippets', docker: 'toolbar.docker' }
const dragHint = computed(() => {
  const id = dragging.value
  if (!id) return ''
  const tool = t(labels[id])
  const edge = dropTarget.value?.edge
  if (!edge) return t('toolbar.layout.dragHint', { tool })
  if (props.layout.tools.find(placement => placement.id === id)?.edge === edge) return t('toolbar.layout.dropOrder', { tool })
  return t('toolbar.layout.drop', { tool, name: t(`toolbar.layout.${edge}`) })
})
const panelIds = WORKSPACE_TOOLS.filter(isWorkspacePanel)
const singlePanel = computed(() => width.value < 900 || height.value < 520)
const railTools = (edge: WorkspaceEdge) => props.layout.tools.filter(tool => tool.edge === edge && props.available.includes(tool.id)).map(tool => tool.id)
const controlEdge = computed(() => WORKSPACE_EDGES.find(edge => railTools(edge).length))
const edgePanels = (edge: WorkspaceEdge) => props.layout.tools.filter(tool => isWorkspacePanel(tool.id) && tool.panelEdge === edge && props.available.includes(tool.id)).map(tool => tool.id as WorkspacePanel)
const activeAt = (edge: WorkspaceEdge) => edgePanels(edge).find(id => props.active[id])
const railStyle = computed(() => ({
  gridTemplateColumns: WORKSPACE_EDGES.map(edge => railTools(edge).length ? 'var(--left-toolbar-width, 40px)' : '0px').join(' minmax(0,1fr) '),
}))
function preferredSize(edge: WorkspaceEdge) { return resizeDraft.value?.edge === edge ? resizeDraft.value.size : props.layout.sizes[edge] }
const areaSizes = computed(() => {
  // Reserve room for side-by-side terminals without changing the saved widths.
  const terminalMinimum = props.splitMode === 'vertical' ? 486 : 320
  const available = canvasWidth.value - (singlePanel.value ? 32 : terminalMinimum)
  const requested = WORKSPACE_EDGES.map(edge => activeAt(edge) ? preferredSize(edge) : 0)
  const active = requested.filter(size => size > 0).length
  const minimums = requested.map(size => Math.min(size, Math.max(0, available) / Math.max(1, active), 240))
  const remaining = Math.max(0, available - minimums[0] - minimums[1])
  const extras = requested.map((size, i) => Math.max(0, size - minimums[i]))
  const scale = Math.min(1, remaining / Math.max(1, extras[0] + extras[1]))
  return { left: Math.floor(minimums[0] + extras[0] * scale), right: Math.floor(minimums[1] + extras[1] * scale) }
})
const canvasStyle = computed(() => ({
  gridTemplateColumns: singlePanel.value ? '0 minmax(0,1fr) 0' : `${areaSizes.value.left}px minmax(0,1fr) ${areaSizes.value.right}px`,
}))
function regionStyle(edge: WorkspaceEdge): CSSProperties {
  if (!singlePanel.value) return { gridArea: edge }
  return { position: 'absolute', [edge]: 0, top: 0, bottom: 0, width: `${areaSizes.value[edge]}px` }
}
function bindBody(edge: WorkspaceEdge, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) bodies[edge] = element
  else delete bodies[edge]
}
function closeMenu(restore = true) {
  const trigger = menu.value?.trigger
  menu.value = undefined
  if (restore && trigger?.isConnected) trigger.focus()
}
async function openMenu(id: WorkspaceTool | undefined, event: MouseEvent) {
  event.preventDefault(); event.stopPropagation()
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const rect = trigger?.getBoundingClientRect()
  menu.value = { id, x: Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : rect?.right || 8,
    y: Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : rect?.bottom || 8, trigger }
  await nextTick()
  if (menuElement.value && menu.value) {
    const position = fitFixedElement(menuElement.value, { x: menu.value.x, y: menu.value.y })
    menu.value.x = position.left; menu.value.y = position.top
    menuElement.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }
}
function change(next: SshWorkspaceLayout) { emit('change', next) }
function move(id: WorkspaceTool, edge: WorkspaceEdge, before?: WorkspaceTool, alignPanel = true) {
  if (!props.ready || props.layout.locked) return
  change(moveWorkspaceTool(props.layout, id, edge, before, alignPanel)); closeMenu(false)
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-tool-id="${id}"]`)?.focus())
}
function reorder(direction: -1 | 1) {
  const id = menu.value?.id
  if (!id) return
  const edge = props.layout.tools.find(tool => tool.id === id)!.edge
  const siblings = railTools(edge), index = siblings.indexOf(id), neighbor = siblings[index + direction]
  if (!neighbor) return
  move(id, edge, direction < 0 ? neighbor : siblings[index + 2], false)
}
function startDrag(id: WorkspaceTool, event: DragEvent) {
  if (!props.ready || props.layout.locked || !event.dataTransfer) { event.preventDefault(); return }
  closeMenu(false); dragging.value = id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-liteconnect-workspace-tool', id)
}
function endDrag() { dragging.value = undefined; dropTarget.value = undefined }
function resolveToolDrop(event: DragEvent): ToolDropTarget | undefined {
  if (!(event.target instanceof Element)) return
  const strip = event.target.closest<HTMLElement>('[data-tool-drop-edge]')
  const stripEdge = strip?.dataset.toolDropEdge
  if (isWorkspaceEdge(stripEdge)) return { edge: stripEdge }

  const rail = event.target.closest<HTMLElement>('.workspace-tool-rail[data-dock-edge]')
  const edge = rail?.dataset.dockEdge
  if (!rail || !isWorkspaceEdge(edge)) return
  const siblings = [...rail.querySelectorAll<HTMLButtonElement>('[data-tool-id]')].filter(button => button.dataset.toolId !== dragging.value)
  const next = siblings.find(button => {
    const rect = button.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2
  })
  const before = next?.dataset.toolId
  const markerId = (next ?? siblings.at(-1))?.dataset.toolId
  return {
    edge,
    before: isWorkspaceTool(before) ? before : undefined,
    marker: isWorkspaceTool(markerId) ? { id: markerId, after: !next } : undefined,
  }
}
function dragOver(event: DragEvent) {
  if (!dragging.value || props.layout.locked) return
  event.preventDefault()
  event.stopPropagation()
  dropTarget.value = resolveToolDrop(event)
  if (event.dataTransfer) event.dataTransfer.dropEffect = dropTarget.value ? 'move' : 'none'
}
function drop(event: DragEvent) {
  const id = dragging.value
  if (!id) return
  event.preventDefault()
  event.stopPropagation()
  const target = resolveToolDrop(event)
  endDrag()
  if (!target) return
  const siblings = railTools(target.edge)
  const index = siblings.indexOf(id)
  if (index >= 0 && siblings[index + 1] === target.before) return
  move(id, target.edge, target.before, false)
}
function resize(edge: WorkspaceEdge, event: PointerEvent) {
  if (!props.ready || props.layout.locked || event.button !== 0) return
  stopResize?.(false)
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture(event.pointerId)
  const start = event.clientX
  const initial = areaSizes.value[edge], pointerId = event.pointerId
  const cursor = document.body.style.cursor, selection = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const delta = (e.clientX - start) * (edge === 'right' ? -1 : 1)
    resizeDraft.value = { edge, size: workspaceSize(edge, initial + delta) }
  }
  const finish = (commit = true) => {
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); window.removeEventListener('keydown', onKey); window.removeEventListener('blur', onCancel)
    document.body.style.cursor = cursor; document.body.style.userSelect = selection
    const draft = resizeDraft.value; resizeDraft.value = undefined; stopResize = undefined
    if (commit && draft && !props.layout.locked) change({ ...props.layout, sizes: { ...props.layout.sizes, [edge]: draft.size } })
  }
  const onUp = (e: PointerEvent) => { if (e.pointerId === pointerId) finish() }
  const onCancel = () => finish(false)
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(false) } }
  stopResize = finish
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel); window.addEventListener('keydown', onKey); window.addEventListener('blur', onCancel)
}
function resizeKey(edge: WorkspaceEdge, event: KeyboardEvent) {
  if (!props.ready || props.layout.locked || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const positive = event.key === 'ArrowRight', sign = edge === 'right' ? -1 : 1
  const value = event.key === 'Home' ? 0 : event.key === 'End' ? 10000 : areaSizes.value[edge] + (positive ? 1 : -1) * sign * (event.shiftKey ? 20 : 8)
  change({ ...props.layout, sizes: { ...props.layout.sizes, [edge]: workspaceSize(edge, value) } })
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
  buttons[index]?.focus()
}
function outside(event: PointerEvent) { if (menu.value && !menuElement.value?.contains(event.target as Node)) closeMenu(false) }
watch(singlePanel, value => emit('single-panel-mode', value), { immediate: true })
watch(() => props.layout, () => { endDrag(); if (props.layout.locked) stopResize?.(false) })
onMounted(() => {
  mounted.value = true
  observer = new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) {
      if (target === canvas.value && contentRect.width) canvasWidth.value = contentRect.width
      if (target === root.value && contentRect.width && contentRect.height) {
        width.value = contentRect.width
        height.value = contentRect.height
      }
    }
  })
  if (root.value) observer.observe(root.value)
  if (canvas.value) observer.observe(canvas.value)
  window.addEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => { observer?.disconnect(); stopResize?.(false); window.removeEventListener('pointerdown', outside, true) })
</script>

<template>
  <div ref="root" class="workspace-dock" :class="{ 'is-single-panel': singlePanel }" :style="railStyle" @dragover="dragOver" @drop="drop" @dragleave="event => { if (!root?.contains(event.relatedTarget as Node)) dropTarget = undefined }">
    <LeftToolbar v-for="edge in WORKSPACE_EDGES" v-show="railTools(edge).length" :key="edge" v-bind="toolbar" class="workspace-tool-rail" :style="{ gridArea: `rail-${edge}` }" :edge="edge" :tool-ids="railTools(edge)" :drop-marker="dropTarget?.edge === edge ? dropTarget.marker : undefined" rearrange :locked="layout.locked || !ready"
      @toggle-ai="emit('toggle', 'ai')" @toggle-files="emit('toggle', 'files')" @toggle-monitor="emit('toggle', 'monitor')" @toggle-batch="emit('toggle', 'batch')" @toggle-sync="emit('toggle', 'sync')" @toggle-snippets="emit('toggle', 'snippets')" @toggle-docker="emit('toggle', 'docker')"
      @tool-menu="openMenu" @tool-drag="startDrag" @tool-drag-end="endDrag">
      <button v-if="edge === controlEdge" class="dock-layout-button ui-icon-btn ui-icon-btn-sm" type="button" :title="t('toolbar.layout.customize')" :aria-label="t('toolbar.layout.customize')" @click="openMenu(undefined, $event)"><AppIcon name="settings" size="sm" /></button>
    </LeftToolbar>
    <div ref="canvas" class="workspace-dock-canvas" :style="canvasStyle">
      <div class="workspace-dock-center"><slot name="center" /></div>
      <div v-if="error" class="dock-layout-error" role="alert"><span>{{ t('toolbar.layout.saveError') }}</span><button class="ui-btn ui-btn-xs" type="button" @click="emit('retry')">{{ t('toolbar.layout.retry') }}</button></div>
      <div v-if="singlePanel && panelIds.some(id => active[id])" class="dock-backdrop" @click="panelIds.filter(id => active[id]).forEach(id => emit('toggle', id))"></div>
      <section v-for="edge in WORKSPACE_EDGES" v-show="activeAt(edge)" :key="edge" class="workspace-dock-region" :class="`dock-${edge}`" :data-dock-edge="edge" :style="regionStyle(edge)" :aria-label="t(`toolbar.layout.${edge}`)">
        <div :ref="element => bindBody(edge, element)" class="workspace-dock-body"></div>
        <div class="workspace-dock-resize" :class="`resize-${edge}`" role="separator" :aria-label="t('toolbar.layout.resize', { name: t(`toolbar.layout.${edge}`) })" aria-orientation="vertical" :aria-valuenow="areaSizes[edge]" aria-valuemin="240" aria-valuemax="720" :aria-disabled="layout.locked || !ready" :tabindex="layout.locked || !ready ? -1 : 0" @pointerdown.prevent="resize(edge, $event)" @keydown="resizeKey(edge, $event)"></div>
      </section>
      <template v-if="mounted && WORKSPACE_EDGES.every(edge => bodies[edge])">
        <Teleport v-for="id in panelIds" :key="id" :to="bodies[workspacePanelEdge(layout, id)]!">
          <div v-show="active[id] && available.includes(id)" :id="`dock-content-${id}`" class="workspace-dock-tool" :data-dock-panel="id" role="region" :aria-label="t(labels[id])"><slot :name="id" /></div>
        </Teleport>
      </template>
      <div v-if="dragging" class="workspace-dock-targets" aria-hidden="true">
        <div v-for="edge in WORKSPACE_EDGES" :key="edge" class="dock-drop-strip" :data-tool-drop-edge="edge" :class="{ selected: dropTarget?.edge === edge && !dropTarget.marker }" />
        <span class="dock-drag-hint">{{ dragHint }}</span>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="menu" ref="menuElement" class="workspace-layout-menu" role="menu" :aria-label="t('toolbar.layout.customize')" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @keydown="menuKey" @contextmenu.prevent>
        <template v-if="menu.id">
          <span class="dock-menu-heading">{{ t(labels[menu.id]) }}</span>
          <button v-for="edge in WORKSPACE_EDGES" :key="edge" role="menuitem" type="button" :data-move-edge="edge" :disabled="!ready || layout.locked" @click="move(menu.id!, edge)">{{ t('toolbar.layout.move', { name: t(`toolbar.layout.${edge}`) }) }}</button>
          <button role="menuitem" type="button" :disabled="!ready || layout.locked || railTools(layout.tools.find(tool => tool.id === menu!.id)!.edge)[0] === menu.id" @click="reorder(-1)">{{ t('toolbar.layout.earlier') }}</button>
          <button role="menuitem" type="button" :disabled="!ready || layout.locked || railTools(layout.tools.find(tool => tool.id === menu!.id)!.edge).at(-1) === menu.id" @click="reorder(1)">{{ t('toolbar.layout.later') }}</button>
          <hr />
        </template>
        <p v-if="error" class="dock-menu-error" role="alert">{{ t('toolbar.layout.saveError') }}</p>
        <button v-if="error" role="menuitem" type="button" @click="emit('retry'); closeMenu()">{{ t('toolbar.layout.retry') }}</button>
        <button role="menuitemcheckbox" type="button" :aria-checked="layout.locked" :disabled="!ready" data-layout-lock @click="change({ ...layout, locked: !layout.locked }); closeMenu()">{{ t(layout.locked ? 'toolbar.layout.unlock' : 'toolbar.layout.lock') }}</button>
        <button role="menuitem" type="button" :disabled="!ready || layout.locked" data-layout-reset @click="change(defaultWorkspaceLayout()); closeMenu()">{{ t('toolbar.layout.reset') }}</button>
        <span v-if="saving" class="dock-menu-heading" role="status">{{ t('toolbar.layout.saving') }}</span>
        <span class="dock-menu-hint">{{ t('toolbar.layout.hint') }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.workspace-dock { display: grid; grid-template-areas: 'rail-left canvas rail-right'; grid-template-rows: minmax(0, 1fr); flex: 1; min-width: 0; min-height: 0; overflow: hidden; -webkit-app-region: no-drag; }
.workspace-dock-canvas { grid-area: canvas; display: grid; grid-template-areas: 'left center right'; grid-template-rows: minmax(0, 1fr); min-width: 0; min-height: 0; position: relative; overflow: hidden; }
.workspace-dock-center { grid-area: center; display: flex; overflow: hidden; min-width: 0; min-height: 0; }
.workspace-dock-region { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; overflow: hidden; background: var(--bg-secondary); border: 1px solid var(--border-color); box-sizing: border-box; }
.workspace-dock-resize:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.workspace-dock-body, .workspace-dock-tool { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.workspace-dock-tool > :deep(*) { min-width: 0; max-width: none; width: 100%; min-height: 0; box-sizing: border-box; }
.workspace-dock-tool > :deep(.snippets-panel), .workspace-dock-tool > :deep(.ai-sidebar), .workspace-dock-tool > :deep(.file-sidebar) { flex: 1; height: 100%; }
.workspace-dock-tool > :deep(.sync-input-bar) { overflow: auto; }
.workspace-dock-resize { position: absolute; z-index: 6; top: 0; bottom: 0; width: 5px; cursor: col-resize; touch-action: none; }
.resize-left { right: 0; }
.resize-right { left: 0; }
.workspace-dock-resize:hover:not([aria-disabled=true]), .workspace-dock-resize:focus-visible { background: var(--accent); }
.workspace-dock-resize[aria-disabled=true] { cursor: default; }
.dock-layout-button { margin-top: auto; margin-bottom: 8px; flex-shrink: 0; }
.dock-backdrop { position: absolute; inset: 0; z-index: 2; background: #0003; }
.is-single-panel .workspace-dock-region { z-index: 3; box-shadow: 0 6px 24px #0004; }
.workspace-dock-targets { --dock-drop-band: 30px; position: absolute; inset: 0; z-index: 20; pointer-events: none; }
.dock-layout-error { position: absolute; z-index: 8; bottom: 8px; left: 8px; right: 8px; width: fit-content; max-width: calc(100% - 16px); display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--danger); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); font-size: var(--font-caption); }
.dock-drop-strip {
  --dock-drop-stroke: 1px;
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--dock-drop-band);
  pointer-events: auto;
  box-sizing: border-box;
  border: 0 solid color-mix(in srgb, var(--text-secondary) 30%, transparent);
  background: color-mix(in srgb, var(--text-secondary) 6%, transparent);
}
.dock-drop-strip.selected {
  --dock-drop-stroke: 2px;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
}
.dock-drop-strip[data-tool-drop-edge='left'] { left: 0; border-left-width: var(--dock-drop-stroke); }
.dock-drop-strip[data-tool-drop-edge='right'] { right: 0; border-right-width: var(--dock-drop-stroke); }
.dock-drag-hint {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 2 * var(--dock-drop-band) - 8px);
  padding: 4px 9px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--font-ui-sm);
  text-align: center;
  overflow-wrap: anywhere;
}
.workspace-layout-menu { position: fixed; z-index: 4000; display: flex; flex-direction: column; min-width: 190px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; padding: 5px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 8px 24px #0004; font-size: var(--font-body); -webkit-app-region: no-drag; }
.workspace-layout-menu button { border: 0; background: transparent; color: inherit; text-align: left; font: inherit; padding: 7px 10px; border-radius: 4px; cursor: pointer; }
.workspace-layout-menu button:hover:not(:disabled), .workspace-layout-menu button:focus-visible { background: var(--accent-bg); color: var(--accent); outline: none; }
.workspace-layout-menu button:disabled { opacity: .45; cursor: default; }
.workspace-layout-menu hr { width: 100%; border: 0; border-top: 1px solid var(--border-color); }
.dock-menu-heading, .dock-menu-hint, .dock-menu-error { padding: 6px 10px; font-size: var(--font-caption); }
.dock-menu-heading { color: var(--text-secondary); }
.dock-menu-hint { max-width: 240px; color: var(--text-secondary); line-height: 1.5; }
.dock-menu-error { color: var(--danger); }
</style>
