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
const collapseAncestors = ref(false)
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
const ancestorItems = computed(() => ancestors.value.map(({ label, path }) => ({ id: path, label, title: path })))

function updateCollapse() {
  const display = pathDisplayRef.value
  if (!display?.clientWidth) return
  const requiredWidth = (rootCrumbRef.value?.offsetWidth ?? 0)
    + (ancestorsRef.value?.offsetWidth ?? 0)
    + (currentCrumbRef.value?.scrollWidth ?? 0)
  collapseAncestors.value = ancestors.value.length > 0 && requiredWidth > display.clientWidth
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
      <span v-if="ancestors.length" ref="ancestorsRef" class="path-ancestors" :class="{ collapsed: collapseAncestors }">
        <template v-for="crumb in ancestors" :key="crumb.path">
          <button type="button" class="path-crumb" :title="crumb.path" :disabled="locked" @click="emit('navigate', crumb.path)">{{ crumb.label }}</button>
          <span aria-hidden="true">/</span>
        </template>
      </span>
      <template v-if="collapseAncestors && ancestors.length">
        <ToolbarDropdown class="path-overflow" :label="t('sftp.pathAncestors')" :items="ancestorItems" menu-class="path-ancestor-menu" icon-only @select="emit('navigate', $event)" />
        <span aria-hidden="true">/</span>
      </template>
      <span ref="currentCrumbRef" class="path-current" aria-current="location">{{ currentCrumb }}</span>
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
        class="bookmark-star"
        :class="{ active: connectionBookmarked }"
        :disabled="locked || !currentPath"
        :title="connectionBookmarked ? t('sftp.removeCurrentBookmark') : t('sftp.bookmarkCurrentPath')"
        @click.stop="emit('toggle-bookmark')"
      >
        <AppIcon :name="connectionBookmarked ? 'star-fill' : 'star'" size="xs" />
      </button>
      <span class="bookmark-divider" aria-hidden="true"></span>
      <button
        type="button"
        class="bookmark-menu-btn"
        :class="{ active: bookmarkMenuOpen }"
        :disabled="locked"
        :title="t('sftp.pathBookmarks')"
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
      @click.stop="onToggle"
    >
      <AppIcon name="edit" size="xs" />
    </button>
    <button
      v-else
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost path-action-btn confirm"
      :title="t('sftp.go')"
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

.path-ancestors {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  width: max-content;
}

.path-ancestors.collapsed {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
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

.path-crumb:hover:not(:disabled) { background: var(--accent-bg); color: var(--accent); }
.path-crumb:disabled { cursor: default; }

.path-current {
  min-width: 0;
  overflow: hidden;
  padding: 3px;
  text-overflow: ellipsis;
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
  width: 26px;
  height: 26px;
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

.bookmark-star,
.bookmark-menu-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.bookmark-star:disabled,
.bookmark-menu-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.bookmark-star.active,
.bookmark-menu-btn.active {
  color: var(--accent);
}

.bookmark-star:hover:not(:disabled),
.bookmark-menu-btn:hover:not(:disabled) {
  color: var(--accent);
}

.bookmark-divider {
  width: 1px;
  height: 12px;
  background: var(--border-color);
}
</style>
