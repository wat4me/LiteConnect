<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiImageAttachment } from '@shared/types/ai'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ image: AiImageAttachment }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)
const viewport = ref<HTMLDivElement | null>(null)
const imageElement = ref<HTMLImageElement | null>(null)
const size = reactive({ width: 0, height: 0 })
const natural = reactive({ width: props.image.width, height: props.image.height })
const offset = reactive({ x: 0, y: 0 })
const pan = reactive({ x: 0, y: 0 })
const zoom = ref(1)
const dragging = ref<'window' | 'image' | null>(null)
const fitScale = computed(() => Math.min(1, size.width / Math.max(1, natural.width), size.height / Math.max(1, natural.height)))
const imageWidth = computed(() => natural.width * fitScale.value * zoom.value)
const imageHeight = computed(() => natural.height * fitScale.value * zoom.value)
const maxZoom = computed(() => Math.max(1, 8 / Math.max(0.001, fitScale.value)))
const canPan = computed(() => imageWidth.value > size.width + 1 || imageHeight.value > size.height + 1)
const scaleLabel = computed(() => `${Math.round(fitScale.value * zoom.value * 100)}%`)
let observer: ResizeObserver | undefined
let gesture: { pointerId: number; element: HTMLElement; x: number; y: number; startX: number; startY: number; minX: number; maxX: number; minY: number; maxY: number } | undefined
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function clampPan() {
  const x = Math.max(0, (imageWidth.value - size.width) / 2)
  const y = Math.max(0, (imageHeight.value - size.height) / 2)
  pan.x = clamp(pan.x, -x, x)
  pan.y = clamp(pan.y, -y, y)
}
function fitImage() { zoom.value = 1; pan.x = 0; pan.y = 0 }
function imageLoaded() {
  natural.width = imageElement.value?.naturalWidth || props.image.width
  natural.height = imageElement.value?.naturalHeight || props.image.height
  fitImage()
}
function zoomImage(next: number, clientX?: number, clientY?: number) {
  const rect = viewport.value?.getBoundingClientRect()
  if (!rect || !fitScale.value) return
  const previous = zoom.value
  zoom.value = clamp(next, 1, maxZoom.value)
  const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2
  const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2
  pan.x = x - (x - pan.x) * zoom.value / previous
  pan.y = y - (y - pan.y) * zoom.value / previous
  clampPan()
}
function wheel(event: WheelEvent) {
  if (event.deltaY) zoomImage(zoom.value * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY)
}
function startDrag(event: PointerEvent, kind: 'window' | 'image') {
  if (event.button !== 0 || gesture || (event.target as HTMLElement).closest('button') || (kind === 'image' && !canPan.value)) return
  const element = event.currentTarget as HTMLElement
  const rect = dialog.value?.getBoundingClientRect()
  if (!rect) return
  event.preventDefault()
  element.setPointerCapture(event.pointerId)
  dragging.value = kind
  const start = kind === 'window' ? offset : pan
  gesture = {
    pointerId: event.pointerId, element, x: event.clientX, y: event.clientY, startX: start.x, startY: start.y,
    minX: offset.x + 8 - rect.left, maxX: offset.x + innerWidth - 8 - rect.right,
    minY: offset.y + 8 - rect.top, maxY: offset.y + innerHeight - 8 - rect.bottom,
  }
}
function moveDrag(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const x = gesture.startX + event.clientX - gesture.x
  const y = gesture.startY + event.clientY - gesture.y
  if (dragging.value === 'window') {
    offset.x = clamp(x, gesture.minX, gesture.maxX)
    offset.y = clamp(y, gesture.minY, gesture.maxY)
  } else { pan.x = x; pan.y = y; clampPan() }
}
function endDrag(event?: PointerEvent) {
  if (!gesture || (event && event.pointerId !== gesture.pointerId)) return
  const current = gesture
  gesture = undefined
  dragging.value = null
  if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId)
}
function resize() { endDrag(); offset.x = 0; offset.y = 0 }
function backdrop(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const rect = element.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) element.close()
}
function keydown(event: KeyboardEvent) {
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomImage(zoom.value * 1.25) }
  else if (event.key === '-') { event.preventDefault(); zoomImage(zoom.value / 1.25) }
  else if (event.key === '0') { event.preventDefault(); fitImage() }
  else if (canPan.value && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    pan.x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0
    pan.y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0
    clampPan()
  }
}
onMounted(() => {
  dialog.value?.showModal()
  observer = new ResizeObserver(() => {
    if (!viewport.value) return
    size.width = viewport.value.clientWidth
    size.height = viewport.value.clientHeight
    zoom.value = Math.min(zoom.value, maxZoom.value)
    clampPan()
  })
  if (viewport.value) observer.observe(viewport.value)
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  endDrag()
  observer?.disconnect()
  window.removeEventListener('resize', resize)
  if (dialog.value?.open) dialog.value.close()
})
onDeactivated(() => { endDrag(); dialog.value?.close() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="ai-image-dialog" :style="{ transform: `translate(${offset.x}px, ${offset.y}px)` }" :aria-label="t('ai.imagePreview')" @close="emit('close')" @click="backdrop" @keydown="keydown">
      <div class="ai-image-preview-head" :class="{ dragging: dragging === 'window' }" @pointerdown="startDrag($event, 'window')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
        <span :title="image.name">{{ image.name }}</span>
        <button type="button" class="ui-icon-btn ai-image-preview-close" :aria-label="t('common.close')" :title="t('common.close')" @click="dialog?.close()"><AppIcon name="close" /></button>
      </div>
      <div ref="viewport" class="ai-image-preview-viewport" :class="{ pannable: canPan, dragging: dragging === 'image' }" tabindex="0" :aria-label="t('ai.imagePreviewHint')" @wheel.prevent="wheel" @pointerdown="startDrag($event, 'image')" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @dblclick="zoom > 1 ? fitImage() : zoomImage(Math.max(2, 1 / fitScale), $event.clientX, $event.clientY)">
        <img ref="imageElement" :src="image.dataUrl" :alt="image.name" draggable="false" :style="{ width: `${imageWidth}px`, height: `${imageHeight}px`, transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px)` }" @load="imageLoaded" @dragstart.prevent />
      </div>
      <div class="ai-image-preview-toolbar" role="group" :aria-label="t('ai.imagePreview')">
        <span class="ai-image-preview-hint">{{ t('ai.imagePreviewHint') }}</span>
        <button type="button" class="ui-icon-btn" :disabled="zoom <= 1" :aria-label="t('ai.imageZoomOut')" :title="t('ai.imageZoomOut')" @click="zoomImage(zoom / 1.25)"><AppIcon name="minus" /></button>
        <output class="ai-image-preview-scale" aria-live="polite">{{ scaleLabel }}</output>
        <button type="button" class="ui-icon-btn" :disabled="zoom >= maxZoom" :aria-label="t('ai.imageZoomIn')" :title="t('ai.imageZoomIn')" @click="zoomImage(zoom * 1.25)"><AppIcon name="plus" /></button>
        <button type="button" class="ui-icon-btn" :aria-label="t('ai.imageFit')" :title="t('ai.imageFit')" @click="fitImage"><AppIcon name="maximize" /></button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ai-image-dialog { position: fixed; inset: 0; margin: auto; width: min(960px, calc(100vw - 32px)); height: min(720px, calc(100dvh - 48px)); max-width: calc(100vw - 32px); max-height: calc(100dvh - 48px); padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--radius-dialog); background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-dialog); -webkit-app-region: no-drag; }
.ai-image-dialog[open] { display: flex; flex-direction: column; }
.ai-image-dialog::backdrop { background: rgb(0 0 0 / 55%); }
.ai-image-preview-head { display: flex; align-items: center; gap: var(--space-3); padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--border-color); flex-shrink: 0; cursor: grab; touch-action: none; user-select: none; }
.ai-image-preview-head.dragging, .ai-image-preview-viewport.pannable.dragging { cursor: grabbing; }
.ai-image-preview-head > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-ui); }
.ai-image-preview-viewport { position: relative; flex: 1; min-height: 0; min-width: 0; overflow: hidden; touch-action: none; user-select: none; background: var(--bg-secondary); }
.ai-image-preview-viewport:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.ai-image-preview-viewport.pannable { cursor: grab; }
.ai-image-preview-viewport img { position: absolute; top: 50%; left: 50%; max-width: none; max-height: none; pointer-events: none; user-select: none; }
.ai-image-preview-toolbar { display: flex; justify-content: flex-end; align-items: center; gap: var(--space-1); padding: 8px 12px; border-top: 1px solid var(--border-color); flex-shrink: 0; }
.ai-image-preview-hint { flex: 1; min-width: 0; color: var(--text-secondary); font-size: var(--font-caption); }
.ai-image-preview-scale { min-width: 48px; text-align: center; font-size: var(--font-caption); font-variant-numeric: tabular-nums; }
@media (max-width: 520px) { .ai-image-preview-hint { display: none; } }
</style>
