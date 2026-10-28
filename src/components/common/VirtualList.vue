<script setup lang="ts" generic="T">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, watch, type ComponentPublicInstance } from 'vue'
import { buildRowOffsets, visibleRowIndices } from '@/utils/shared/virtualRows'

const props = withDefaults(defineProps<{
  items: readonly T[]
  itemKey: (item: T) => string
  estimatedSize: number
  scrollContainer?: HTMLElement | null
  gap?: number
  threshold?: number
  pinnedKey?: string | null
  preserveAnchor?: boolean
  role?: 'list' | 'presentation'
}>(), { gap: 0, threshold: 80, scrollContainer: null, pinnedKey: null, preserveAnchor: false, role: 'list' })

const emit = defineEmits<{ 'range-resized': [] }>()

const contentRef = ref<HTMLElement | null>(null)
const sizes = shallowRef<ReadonlyMap<string, number>>(new Map())
const viewportTop = ref(0)
const viewportHeight = ref(600)
const focusedKey = ref<string | null>(null)
const anchorKey = ref<string | null>(null)
const enabled = computed(() => props.items.length > props.threshold)
const keys = computed(() => props.items.map(props.itemKey))
const offsets = computed(() => buildRowOffsets(keys.value, sizes.value, props.estimatedSize + props.gap))
const totalSize = computed(() => offsets.value[offsets.value.length - 1])
const indices = computed(() => {
  if (!enabled.value) return props.items.map((_, index) => index)
  const result = new Set(visibleRowIndices(offsets.value, viewportTop.value, viewportHeight.value))
  for (const key of [props.pinnedKey, focusedKey.value, anchorKey.value]) {
    if (!key) continue
    const index = keys.value.indexOf(key)
    if (index >= 0) result.add(index)
  }
  return [...result].sort((a, b) => a - b)
})
const rows = computed(() => indices.value.map(index => ({ item: props.items[index], index, key: keys.value[index] })))
const elements = new Map<string, HTMLElement>()
let observer: ResizeObserver | null = null
let container: HTMLElement | null = null
let raf = 0
let width = 0
let measurePending = false

function updateViewport() {
  const content = contentRef.value
  if (!content || !container) return
  // The same list works inside its own scroller or a shared group-tree scroller.
  viewportTop.value = container.getBoundingClientRect().top + container.clientTop - content.getBoundingClientRect().top
  viewportHeight.value = container.clientHeight || 600
}

function scheduleViewport() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    updateViewport()
    if (measurePending) {
      measurePending = false
      const anchor = enabled.value ? visibleRowIndices(offsets.value, viewportTop.value, viewportHeight.value, 0)[0] : undefined
      const previousAnchorTop = anchor === undefined ? 0 : offsets.value[anchor]
      const nextWidth = container?.clientWidth || 0
      const next = nextWidth === width ? new Map(sizes.value) : new Map<string, number>()
      width = nextWidth
      let changed = next.size !== sizes.value.size
      for (const [key, element] of elements) {
        const size = element.getBoundingClientRect().height
        if (size > 0 && Math.abs((next.get(key) || 0) - size) > 0.1) {
          next.set(key, size)
          changed = true
        }
      }
      if (changed) {
        sizes.value = next
        const delta = anchor === undefined ? 0 : offsets.value[anchor] - previousAnchorTop
        const scroller = container
        // Notify consumers after anchoring so a log follower can choose the bottom.
        void nextTick(() => {
          if (container === scroller && contentRef.value?.isConnected) {
            if (delta !== 0 && scroller) {
              scroller.scrollTop += delta
              updateViewport()
            }
            emit('range-resized')
          }
        })
      }
    }
    updateViewport()
  })
}

function setElement(key: string, node: Element | ComponentPublicInstance | null) {
  const previous = elements.get(key)
  if (previous === node) return
  if (previous) observer?.unobserve(previous)
  if (node instanceof HTMLElement) {
    elements.set(key, node)
    observer?.observe(node)
  } else elements.delete(key)
}

function attachContainer() {
  const next = props.scrollContainer || contentRef.value?.parentElement || null
  if (container === next) return
  if (container) {
    container.removeEventListener('scroll', scheduleViewport)
    observer?.unobserve(container)
  }
  container = next
  if (container) {
    container.addEventListener('scroll', scheduleViewport, { passive: true })
    observer?.observe(container)
  }
  updateViewport()
}

function scrollToIndex(index: number) {
  attachContainer()
  if (!container || index < 0 || index >= props.items.length) return
  updateViewport()
  const top = offsets.value[index]
  const bottom = offsets.value[index + 1]
  const current = viewportTop.value
  const next = top < current ? top : bottom > current + viewportHeight.value ? bottom - viewportHeight.value : current
  container.scrollTop += next - current
  updateViewport()
}

function resetScroll() {
  if (!container) return
  container.scrollTop = 0
  updateViewport()
}

function onFocusOut(event: FocusEvent) {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(event.relatedTarget)) {
    focusedKey.value = null
  }
}

watch(() => props.scrollContainer, attachContainer, { flush: 'post' })
watch(() => [props.estimatedSize, props.gap], () => { sizes.value = new Map(); scheduleViewport() })
let anchorVersion = 0
watch(keys, next => {
  const version = ++anchorVersion
  const retained = new Set(next)
  let anchor: { key: string; top: number } | null = null
  const scroller = container
  if (props.preserveAnchor && scroller) {
    const edge = scroller.getBoundingClientRect().top + scroller.clientTop
    for (const [key, element] of elements) {
      if (!retained.has(key)) continue
      const rect = element.getBoundingClientRect()
      if (rect.bottom > edge && (!anchor || rect.top < anchor.top)) anchor = { key, top: rect.top }
    }
  }
  anchorKey.value = anchor?.key ?? null
  sizes.value = new Map([...sizes.value].filter(([key]) => retained.has(key)))
  void nextTick(() => {
    if (version !== anchorVersion) return
    if (anchor && container === scroller && scroller && contentRef.value?.isConnected) {
      const element = elements.get(anchor.key)
      if (element) scroller.scrollTop += element.getBoundingClientRect().top - anchor.top
      updateViewport()
    }
    anchorKey.value = null
    scheduleViewport()
  })
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      // ResizeObserver callbacks only schedule work; mutating list heights in
      // the notification turn can create resize-observer delivery loops.
      measurePending = true
      scheduleViewport()
    })
    for (const element of elements.values()) observer.observe(element)
    if (contentRef.value) observer.observe(contentRef.value)
  }
  attachContainer()
})
onUpdated(scheduleViewport)
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  container?.removeEventListener('scroll', scheduleViewport)
  observer?.disconnect()
  elements.clear()
})
defineExpose({ scrollToIndex, resetScroll })
</script>

<template>
  <div ref="contentRef" class="virtual-list" :role="role" :data-virtual="enabled" :data-item-count="items.length" :style="enabled ? { height: `${totalSize}px` } : undefined">
    <div
      v-for="row in rows"
      :key="row.key"
      :ref="node => setElement(row.key, node)"
      class="virtual-row"
      :data-virtual-key="row.key"
      :role="role === 'list' ? 'listitem' : 'presentation'"
      :aria-setsize="role === 'list' ? items.length : undefined"
      :aria-posinset="role === 'list' ? row.index + 1 : undefined"
      :style="{ paddingBottom: `${gap}px`, ...(enabled ? { position: 'absolute', top: `${offsets[row.index]}px`, left: 0, right: 0 } : {}) }"
      @focusin="focusedKey = row.key"
      @focusout="onFocusOut"
    >
      <slot :item="row.item" :index="row.index" />
    </div>
  </div>
</template>

<style scoped>
.virtual-list { position: relative; min-width: 0; overflow-anchor: none; }
.virtual-row { min-width: 0; box-sizing: border-box; }
</style>
