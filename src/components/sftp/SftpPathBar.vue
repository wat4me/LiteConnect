<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SftpPathBookmark, SftpPathBookmarkScope } from '@shared/types/sftp'
import AppIcon from '../icons/AppIcon.vue'
import ToolbarDropdown from '../common/ToolbarDropdown.vue'
import SftpBookmarkMenu from './SftpBookmarkMenu.vue'

const { t } = useI18n()

const props = defineProps<{
  currentPath: string
  pathInput: string
  showPathInput: boolean
  /** Ignore path edit / jump while SFTP action is in flight (no visual dim). */
  locked?: boolean
  connectionBookmarks?: SftpPathBookmark[]
  globalBookmarks?: SftpPathBookmark[]
  /** Current path is saved on this connection. Global bookmarks do not fill the star. */
  connectionBookmarked?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:pathInput', value: string): void
  (e: 'toggle'): void
  (e: 'submit'): void
  (e: 'cancel'): void
  (e: 'blur-submit'): void
  (e: 'navigate', path: string): void
  (e: 'toggle-bookmark'): void
  (e: 'add-bookmark', scope: SftpPathBookmarkScope): void
  (e: 'open-bookmark', bookmark: SftpPathBookmark): void
  (e: 'rename-bookmark', bookmark: SftpPathBookmark): void
  (e: 'edit-bookmark-path', bookmark: SftpPathBookmark): void
  (e: 'remove-bookmark', bookmark: SftpPathBookmark): void
  (e: 'move-bookmark', bookmark: SftpPathBookmark, direction: -1 | 1): void
  (e: 'reorder-bookmark', draggedId: string, targetId: string, place: 'before' | 'after'): void
}>()

function onToggle() {
  if (props.locked) return
  emit('toggle')
}

function onSubmit() {
  if (props.locked) return
  emit('submit')
}

const pathInputRef = ref<HTMLInputElement | null>(null)
const pathDisplayRef = ref<HTMLElement | null>(null)
const rootCrumbRef = ref<HTMLButtonElement | null>(null)
const ancestorsRef = ref<HTMLElement | null>(null)
const currentCrumbRef = ref<HTMLElement | null>(null)
/** Leading ancestors folded into the "…" menu; the nearest parents stay visible. */
const hiddenAncestorCount = ref(0)
/** Width each visible ancestor may shrink to (ellipsis) before another one is folded. */
const ancestorMinWidths = ref<number[]>([])
const collapseAncestors = computed(() => hiddenAncestorCount.value > 0)
const bookmarkWrapRef = ref<HTMLElement | null>(null)
const bookmarkMenuOpen = ref(false)
let pathEditCanceling = false

function toggleBookmarkMenu() {
  if (props.locked) return
  bookmarkMenuOpen.value = !bookmarkMenuOpen.value
}

const displayPath = computed(() => {
  const raw = props.currentPath || ''
  return raw.replace(/\/+$/, '') || '/'
})

const pathCrumbs = computed(() => Array.from(displayPath.value.matchAll(/[^/]+/g), (match) => ({
  label: match[0],
  path: displayPath.value.slice(0, match.index + match[0].length),
})))
const ancestors = computed(() => pathCrumbs.value.slice(0, -1))
const currentCrumb = computed(() => pathCrumbs.value.at(-1)?.label || '/')
const visibleAncestors = computed(() => ancestors.value.slice(hiddenAncestorCount.value))
// The menu lists every ancestor: visible ones may be shortened with an ellipsis.
const ancestorItems = computed(() => ancestors.value.map(({ path }) => ({ id: path, label: path, title: path })))

/** Characters an ancestor keeps before it is replaced by the "…" menu. */
const MIN_ANCESTOR_CHARS = 4
const OVERFLOW_TRIGGER_WIDTH = 22

/**
 * Fold ancestors from the root side one at a time (like Explorer / Finder):
 * the current directory and its nearest parents stay readable, long names are
 * shortened first, and only what still does not fit moves into the menu.
 */
/** Shorten the widest crumbs first so every visible one stays recognisable. */
function allocateWidths(full: number[], min: number[], budget: number): number[] {
  if (full.reduce((sum, width) => sum + width, 0) <= budget) return full
  const widthsFor = (cap: number) => full.map((width, i) => Math.max(min[i], Math.min(width, cap)))
  let low = 0
  let high = Math.max(...full)
  for (let step = 0; step < 24; step++) {
    const cap = (low + high) / 2
    if (widthsFor(cap).reduce((sum, width) => sum + width, 0) > budget) high = cap
    else low = cap
  }
  return widthsFor(low).map(Math.floor)
}

function updateCollapse() {
  const display = pathDisplayRef.value
  const measurer = ancestorsRef.value
  if (!display?.clientWidth || !measurer) return
  const full = [...measurer.querySelectorAll<HTMLElement>('.path-crumb')].map((crumb) => Math.ceil(crumb.getBoundingClientRect().width))
  const separator = Math.ceil(measurer.querySelector<HTMLElement>('.path-sep')?.getBoundingClientRect().width ?? 7)
  const ellipsisMin = Math.ceil((measurer.querySelector<HTMLElement>('.path-char')?.getBoundingClientRect().width ?? 70) / 10 * (MIN_ANCESTOR_CHARS + 1)) + 6
  const min = full.map((width) => Math.min(width, ellipsisMin))
  const current = Math.ceil(measurer.querySelector<HTMLElement>('.path-current-measure')?.getBoundingClientRect().width ?? 0)
  const root = Math.ceil(rootCrumbRef.value?.getBoundingClientRect().width ?? 0)
  // The current directory is never shortened while an ancestor is still shown.
  const available = display.clientWidth - root - current - 1
  let hidden = 0
  for (; hidden < full.length; hidden++) {
    const overflow = hidden > 0 ? OVERFLOW_TRIGGER_WIDTH + separator : 0
    const needed = min.slice(hidden).reduce((sum, width) => sum + width + separator, 0)
    if (overflow + needed <= available) break
  }
  const overflow = hidden > 0 ? OVERFLOW_TRIGGER_WIDTH + separator : 0
  const visibleCount = full.length - hidden
  const budget = available - overflow - visibleCount * separator
  ancestorMinWidths.value = [
    ...full.slice(0, hidden),
    ...allocateWidths(full.slice(hidden), min.slice(hidden), Math.max(0, budget)),
  ]
  hiddenAncestorCount.value = hidden
}

watch(pathDisplayRef, (display, _, onCleanup) => {
  if (!display) return
  const observer = new ResizeObserver(updateCollapse)
  observer.observe(display)
  updateCollapse()
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })
watch(displayPath, updateCollapse, { flush: 'post' })

const localInput = computed({
  get: () => props.pathInput,
  set: (v: string) => emit('update:pathInput', v),
})

watch(
  () => props.showPathInput,
  async (val) => {
    if (val) {
      bookmarkMenuOpen.value = false
      pathEditCanceling = false
      await nextTick()
      pathInputRef.value?.focus()
      pathInputRef.value?.select()
    }
  },
)

watch(
  () => props.locked,
  (locked) => {
    if (locked) bookmarkMenuOpen.value = false
  },
)

function onCancel() {
  pathEditCanceling = true
  emit('cancel')
}

function onBlur() {
  if (pathEditCanceling) {
    pathEditCanceling = false
    return
  }
  emit('blur-submit')
}
</script>

<template>
  <div
    class="ui-field path-field"
    :class="{ focused: showPathInput }"
    :title="showPathInput ? undefined : (currentPath || '')"
  >
    <nav
      v-if="!showPathInput"
      ref="pathDisplayRef"
      class="path-display"
      :title="displayPath"
      :aria-label="t('sftp.pathBreadcrumbs')"
    >
      <button v-if="displayPath.startsWith('/') && pathCrumbs.length" ref="rootCrumbRef" type="button" class="path-crumb" :disabled="locked" :aria-label="t('sftp.openRootDirectory')" @click="emit('navigate', '/')">/</button>
      <!-- Invisible copy at natural width, used only to measure what fits. -->
      <span ref="ancestorsRef" class="path-measure" aria-hidden="true">
        <span v-for="crumb in ancestors" :key="crumb.path" class="path-crumb">{{ crumb.label }}</span>
        <span class="path-sep">/</span>
        <span class="path-char">0000000000</span>
        <span class="path-current path-current-measure">{{ currentCrumb }}</span>
      </span>
      <template v-if="collapseAncestors">
        <ToolbarDropdown class="path-overflow" :label="t('sftp.pathAncestors')" :items="ancestorItems" menu-class="path-ancestor-menu" icon-only @select="emit('navigate', $event)" />
        <span class="path-sep" aria-hidden="true">/</span>
      </template>
      <template v-for="(crumb, index) in visibleAncestors" :key="crumb.path">
        <button
          type="button"
          class="path-crumb path-ancestor"
          :style="{ width: `${ancestorMinWidths[index + hiddenAncestorCount] ?? 0}px` }"
          :title="crumb.path"
          :disabled="locked"
          @click="emit('navigate', crumb.path)"
        >{{ crumb.label }}</button>
        <span class="path-sep" aria-hidden="true">/</span>
      </template>
      <!-- Clicking the current directory edits the path, as in a file manager address bar. -->
      <span
        ref="currentCrumbRef"
        class="path-current"
        aria-current="location"
        :title="t('sftp.editPath')"
        @click="onToggle"
      >{{ currentCrumb }}</span>
    </nav>
    <form v-else class="path-inline-form" @submit.prevent="onSubmit">
      <input
        ref="pathInputRef"
        v-model="localInput"
        class="path-input"
        :placeholder="t('sftp.pathPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @blur="onBlur"
        @keydown.escape.prevent="onCancel"
      />
    </form>
    <div v-if="!showPathInput" ref="bookmarkWrapRef" class="bookmark-control" :class="{ open: bookmarkMenuOpen }">
      <button
        type="button"
        class="bookmark-star ui-icon-btn ui-icon-btn-sm"
        :class="{ active: connectionBookmarked }"
        :disabled="locked || !currentPath"
        :title="connectionBookmarked ? t('sftp.removeCurrentBookmark') : t('sftp.bookmarkCurrentPath')"
        :aria-label="connectionBookmarked ? t('sftp.removeCurrentBookmark') : t('sftp.bookmarkCurrentPath')"
        @click.stop="emit('toggle-bookmark')"
      >
        <AppIcon :name="connectionBookmarked ? 'star-fill' : 'star'" size="xs" />
      </button>
      <span class="bookmark-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="bookmark-menu-btn ui-icon-btn ui-icon-btn-sm"
        :class="{ active: bookmarkMenuOpen }"
        :disabled="locked"
        :title="t('sftp.pathBookmarks')"
        :aria-label="t('sftp.pathBookmarks')"
        :aria-expanded="bookmarkMenuOpen"
        :aria-haspopup="true"
        @click.stop="toggleBookmarkMenu"
      >
        <AppIcon name="chevron-down" size="xs" />
      </button>
    </div>
    <SftpBookmarkMenu
      :open="bookmarkMenuOpen"
      :anchor="bookmarkWrapRef"
      :current-path="currentPath"
      :connection-bookmarks="connectionBookmarks"
      :global-bookmarks="globalBookmarks"
      @close="bookmarkMenuOpen = false"
      @add-bookmark="emit('add-bookmark', $event)"
      @open-bookmark="emit('open-bookmark', $event)"
      @rename-bookmark="emit('rename-bookmark', $event)"
      @edit-bookmark-path="emit('edit-bookmark-path', $event)"
      @remove-bookmark="emit('remove-bookmark', $event)"
      @move-bookmark="(bookmark, direction) => emit('move-bookmark', bookmark, direction)"
      @reorder-bookmark="(draggedId, targetId, place) => emit('reorder-bookmark', draggedId, targetId, place)"
    />
    <button
      v-if="!showPathInput"
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost path-action-btn"
      :title="t('sftp.editPath')"
      :aria-label="t('sftp.editPath')"
      @click.stop="onToggle"
    >
      <AppIcon name="edit" size="xs" />
    </button>
    <button
      v-else
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost path-action-btn confirm"
      :title="t('sftp.go')"
      :aria-label="t('sftp.go')"
      @mousedown.prevent
      @click="onSubmit"
    >
      <AppIcon name="check" size="xs" />
    </button>
  </div>
</template>

<style scoped>
.path-field {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding-right: 4px;
  box-sizing: border-box;
  position: relative;
}

.path-display {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.2;
}

.path-measure {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-flex;
  width: max-content;
  visibility: hidden;
  pointer-events: none;
}

.path-sep {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.path-crumb {
  flex-shrink: 0;
  padding: 3px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.path-crumb:hover:not(:disabled) { background: var(--tab-hover-surface); color: var(--text-primary); }
.path-crumb:disabled { cursor: default; }

/* Ancestors give up space long before the current directory does. */
.path-ancestor {
  flex: 0 0 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

/* Only shrinks when it alone is wider than the field (all ancestors already folded). */
.path-current {
  flex: 0 1 auto;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  padding: 3px;
  text-overflow: ellipsis;
  font-weight: 600;
  cursor: text;
  border-radius: var(--radius-sm);
}

.path-current:hover {
  background: var(--tab-hover-surface);
}

.path-display .path-overflow { position: static; }
.path-overflow :deep(.dropdown-trigger) { width: 22px; height: 22px; }
.path-overflow :deep(.path-ancestor-menu) {
  width: min(300px, 100%);
  min-width: 0;
  max-height: 220px;
  border-radius: var(--radius-lg);
}

.path-inline-form {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 100%;
}

.path-input {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 12px;
  line-height: 1.3;
}

.path-input::placeholder {
  color: var(--text-secondary);
}

.path-action-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
}

.bookmark-control {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 22px;
  margin-right: 2px;
  border-radius: 4px;
}

.bookmark-control:hover,
.bookmark-control.open {
  background: var(--bg-hover);
}

/* Sized to sit inside the 28px path field. */
.bookmark-star,
.bookmark-menu-btn {
  width: 22px;
  height: 22px;
}

.bookmark-divider {
  width: 1px;
  height: 12px;
  background: var(--border-color);
}
</style>
