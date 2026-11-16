<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import { tabOverflow, tabScrollDelta } from '@/utils/shared/tabScroll'

const props = defineProps<{ activeKey: string | null }>()
const { t } = useI18n()

const containerRef = ref<HTMLElement | null>(null)
const stripRef = ref<HTMLElement | null>(null)
const trackRef = ref<HTMLElement | null>(null)
const overflowing = ref(false)
const canScroll = ref({ left: false, right: false })
let observer: ResizeObserver | undefined
let lastWidth = 0

function updateScrollDirections() {
  if (stripRef.value) canScroll.value = tabOverflow(stripRef.value)
}

function revealActiveTab() {
  const strip = stripRef.value
  const active = strip?.querySelector<HTMLElement>('[data-active-tab="true"]')
  if (strip?.clientWidth && active) {
    strip.scrollLeft += tabScrollDelta(strip.getBoundingClientRect(), active.getBoundingClientRect(), 0)
  }
  updateScrollDirections()
}

function updateLayout(activation = false) {
  const width = containerRef.value?.clientWidth ?? 0
  const resized = width !== lastWidth
  lastWidth = width
  const track = trackRef.value
  if (!width || !track) return
  // Compare against the full space so the arrows disappear once the tabs fit again.
  const next = track.offsetWidth > width + 1
  if (next !== overflowing.value) {
    overflowing.value = next
    void nextTick(revealActiveTab)
  } else if (activation || resized) {
    revealActiveTab()
  } else {
    // Badge and label updates can resize the track without resizing the viewport.
    updateScrollDirections()
  }
}

function scrollTabs(direction: -1 | 1) {
  const strip = stripRef.value
  if (!strip) return
  strip.scrollLeft += direction * Math.max(120, Math.floor(strip.clientWidth * 0.8))
  updateScrollDirections()
}

function onWheel(event: WheelEvent) {
  const strip = stripRef.value
  if (!strip || event.ctrlKey || event.metaKey) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  const { left, right } = tabOverflow(strip)
  if (!delta || (delta < 0 ? !left : !right)) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
  event.preventDefault()
  strip.scrollLeft += delta * unit
  updateScrollDirections()
}

watch(() => props.activeKey, () => updateLayout(true), { flush: 'post' })

onMounted(() => {
  if (!containerRef.value || !trackRef.value) return
  observer = new ResizeObserver(() => updateLayout())
  observer.observe(containerRef.value)
  observer.observe(trackRef.value)
  updateLayout()
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="containerRef" class="scrollable-tabs" @wheel="onWheel">
    <button
      v-if="overflowing"
      type="button"
      class="tabs-overflow-btn ui-icon-btn"
      data-tabs-scroll="left"
      :disabled="!canScroll.left"
      :title="t('terminal.scrollTabsLeft')"
      :aria-label="t('terminal.scrollTabsLeft')"
      @click="scrollTabs(-1)"
    >
      <AppIcon name="chevron-left" size="xs" />
    </button>
    <div ref="stripRef" class="tabs-scroll" @scroll.passive="updateScrollDirections">
      <div ref="trackRef" class="tabs-track">
        <slot />
      </div>
    </div>
    <button
      v-if="overflowing"
      type="button"
      class="tabs-overflow-btn ui-icon-btn"
      data-tabs-scroll="right"
      :disabled="!canScroll.right"
      :title="t('terminal.scrollTabsRight')"
      :aria-label="t('terminal.scrollTabsRight')"
      @click="scrollTabs(1)"
    >
      <AppIcon name="chevron-right" size="xs" />
    </button>
  </div>
</template>

<style scoped>
.scrollable-tabs {
  display: flex;
  align-items: stretch;
  height: 100%;
  min-width: 0;
}

.tabs-scroll {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.tabs-track {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--tabs-track-gap, 0);
  padding-inline-start: var(--tabs-track-padding, 0);
}

/* Narrow full-height chevron strip at the tab-bar edges. */
.tabs-overflow-btn {
  flex: 0 0 18px;
  width: 18px;
  height: auto;
  margin-block: 2px;
  border-radius: var(--radius-sm);
  -webkit-app-region: no-drag;
}

.tabs-overflow-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
