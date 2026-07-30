<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../../env.d.ts'
import { formatSize } from '@/utils/shared/format'
import { ancestorPaths } from '../../composables/sftp/useSftpDirTree'
import { useSftpTreeScroll } from '../../composables/sftp/useSftpTreeScroll'
import { useSftpTreeKeyboard } from '../../composables/sftp/useSftpTreeKeyboard'
import FileTypeIcon from './FileTypeIcon.vue'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  currentPath: string
  entriesOf: (path: string) => FileEntry[]
  isExpanded: (path: string) => boolean
  isLoading: (path: string) => boolean
  loading?: boolean
  error?: string
  activeTransfers?: number
  canEdit?: (name: string) => boolean
  /** External file drag active (from parent sidebar) */
  externalDragActive?: boolean
  /** Directory path currently targeted for drop upload */
  dropTargetPath?: string | null
}>()

const emit = defineEmits<{
  (e: 'selectDir', path: string): void
  (e: 'toggle', path: string): void
  (e: 'download', entry: FileEntry): void
  (e: 'downloadMany', entries: FileEntry[]): void
  (e: 'deleteMany', entries: FileEntry[]): void
  (e: 'contextMenu', event: MouseEvent, entry: FileEntry): void
  (e: 'edit', entry: FileEntry): void
  (e: 'rename', entry: FileEntry): void
  (e: 'retry'): void
  /** Hovered upload target while dragging local files */
  (e: 'drop-target', path: string | null): void
}>()

function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files')
}

function onDirDragOver(e: DragEvent, path: string) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  emit('drop-target', path)
}

function onTreeBackgroundDragOver(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  // Dropping on empty/tree background → current directory
  emit('drop-target', props.currentPath || '/')
}

function onTreeDragLeave(e: DragEvent) {
  if (!isFileDrag(e)) return
  const related = e.relatedTarget as Node | null
  const root = explorerRef.value
  if (related && root?.contains(related)) return
  emit('drop-target', null)
}

type FlatRow =
  | { kind: 'dir'; name: string; path: string; depth: number; entry: FileEntry | null }
  | { kind: 'file'; name: string; path: string; depth: number; entry: FileEntry }
  | { kind: 'more'; path: string; parentPath: string; depth: number; shown: number; total: number }

/** 每个目录下默认最多展示的文件数（目录始终全部展示） */
const INITIAL_FILE_LIMIT = 50

const searchQuery = ref('')
const searchVisible = ref(false)
const selectedPaths = ref<Set<string>>(new Set())
const focusedPath = ref('')
/** path → 该目录下文件的展示上限 */
const fileLimitByPath = ref<Record<string, number>>({})
const rowElements = new Map<string, HTMLElement>()
const explorerRef = ref<HTMLElement | null>(null)
const treeScrollRef = ref<HTMLElement | null>(null)
let searchInputRef: HTMLInputElement | null = null
/** Shift-range selection anchor (files) + last dir click target. */
let lastClickedPath: string | null = null
/**
 * One-shot: click already has the row under the cursor; the following currentPath
 * change should preserve scroll instead of scrollIntoView. Consumed by the path watch.
 * (Sticky lastClickedPath used to block locate/follow reveal forever after a click.)
 */
let preserveScrollForPath: string | null = null

const setSearchInputRef = (el: any) => {
  searchInputRef = el as HTMLInputElement | null
}

/** Only true directories (backend marks symlink→dir as isDirectory). File symlinks stay files. */
function isDir(entry: FileEntry): boolean {
  return !!entry.isDirectory
}

function isFile(entry: FileEntry): boolean {
  return !entry.isDirectory
}

function cleanPath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

function fileLimitOf(path: string): number {
  return fileLimitByPath.value[cleanPath(path)] ?? INITIAL_FILE_LIMIT
}

function showMoreFiles(parentPath: string) {
  const clean = cleanPath(parentPath)
  const current = fileLimitOf(clean)
  fileLimitByPath.value = {
    ...fileLimitByPath.value,
    [clean]: current + INITIAL_FILE_LIMIT,
  }
}

function showAllFiles(parentPath: string, total: number) {
  const clean = cleanPath(parentPath)
  fileLimitByPath.value = {
    ...fileLimitByPath.value,
    [clean]: Math.max(total, fileLimitOf(clean)),
  }
}

/** 扁平可见树：只渲染已展开目录下的子项；文件按目录分页，避免大目录卡顿。
 *  根 `/` 不单独成行（无意义），直接展示其子项。
 */
const visibleRows = computed((): FlatRow[] => {
  const q = searchQuery.value.trim().toLowerCase()
  const searching = q.length > 0
  const rows: FlatRow[] = []

  function appendChildren(parentPath: string, depth: number) {
    const kids = props.entriesOf(parentPath)
    const dirs: FileEntry[] = []
    const files: FileEntry[] = []
    for (const child of kids) {
      if (isDir(child)) dirs.push(child)
      else files.push(child)
    }

    for (const child of dirs) {
      walkDir(child.path, child.name, depth, child)
    }

    // 搜索时不过滤数量，便于在已加载数据中找文件
    const matchedFiles = searching
      ? files.filter((f) => f.name.toLowerCase().includes(q))
      : files
    const limit = searching ? matchedFiles.length : fileLimitOf(parentPath)
    const visible = matchedFiles.slice(0, limit)
    for (const child of visible) {
      rows.push({ kind: 'file', name: child.name, path: child.path, depth, entry: child })
    }
    if (!searching && matchedFiles.length > visible.length) {
      rows.push({
        kind: 'more',
        path: `${parentPath}\0__more__`,
        parentPath,
        depth,
        shown: visible.length,
        total: matchedFiles.length,
      })
    }
  }

  function walkDir(path: string, name: string, depth: number, entry: FileEntry | null) {
    rows.push({ kind: 'dir', name, path, depth, entry })
    if (!props.isExpanded(path)) return
    appendChildren(path, depth + 1)
  }

  // 根始终当作已展开：不渲染 `/` 行，直接列一级子项
  appendChildren('/', 0)
  return rows
})

const selectedFileEntries = computed(() => {
  const map = new Map<string, FileEntry>()
  for (const row of visibleRows.value) {
    if (row.kind === 'file' && selectedPaths.value.has(row.path)) {
      map.set(row.path, row.entry)
    }
  }
  return [...map.values()]
})

const selectedCount = computed(() => selectedPaths.value.size)
const directoryCount = computed(() => visibleRows.value.filter((row) => row.kind === 'dir').length)
const fileCount = computed(() => visibleRows.value.filter((row) => row.kind === 'file').length)
const hiddenFileTotal = computed(() =>
  visibleRows.value
    .filter((row): row is Extract<FlatRow, { kind: 'more' }> => row.kind === 'more')
    .reduce((sum, row) => sum + (row.total - row.shown), 0),
)

function setRowRef(el: unknown, path: string) {
  if (el instanceof HTMLElement) rowElements.set(path, el)
  else rowElements.delete(path)
}

const {
  captureTreeScroll,
  scheduleRestoreTreeScroll,
  focusRow,
  requestRevealPath,
  forceRevealPath,
  tryRevealPendingPath,
  hasPendingReveal,
} = useSftpTreeScroll({
  treeScrollRef,
  rowElements,
  cleanPath,
  setFocusedPath: (path) => { focusedPath.value = path },
  focusExplorer: () => { explorerRef.value?.focus({ preventScroll: true }) },
})

function isCurrent(path: string): boolean {
  const cur = props.currentPath.replace(/\/+$/, '') || '/'
  const p = path.replace(/\/+$/, '') || '/'
  return cur === p
}

function isOnActiveBranch(path: string): boolean {
  return ancestorPaths(props.currentPath).includes(path.replace(/\/+$/, '') || '/')
}

function toggleSelect(entry: FileEntry, e?: MouseEvent) {
  if (!isFile(entry)) return
  const next = new Set(selectedPaths.value)
  if (e?.shiftKey && lastClickedPath) {
    const list = visibleRows.value.filter((r) => r.kind === 'file') as Extract<FlatRow, { kind: 'file' }>[]
    const a = list.findIndex((f) => f.path === lastClickedPath)
    const b = list.findIndex((f) => f.path === entry.path)
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a]
      for (let i = from; i <= to; i++) next.add(list[i].path)
      selectedPaths.value = next
      lastClickedPath = entry.path
      return
    }
  }
  if (next.has(entry.path)) next.delete(entry.path)
  else next.add(entry.path)
  selectedPaths.value = next
  lastClickedPath = entry.path
}

function onMoreClick(row: Extract<FlatRow, { kind: 'more' }>, e: MouseEvent) {
  e.stopPropagation()
  focusRow(row.path)
  showMoreFiles(row.parentPath)
}

function onShowAllClick(row: Extract<FlatRow, { kind: 'more' }>, e: MouseEvent) {
  e.stopPropagation()
  focusRow(row.path)
  showAllFiles(row.parentPath, row.total)
}

function clearSelection() {
  selectedPaths.value = new Set()
  lastClickedPath = null
}

function onDirClick(path: string) {
  // Row is under the cursor — do not scrollIntoView; lock scroll for empty-dir reflow.
  lastClickedPath = path
  preserveScrollForPath = path
  captureTreeScroll(900)
  focusRow(path, { scroll: 'never' })
  emit('selectDir', path)
  scheduleRestoreTreeScroll()
}

/** Toolbar "locate cwd" / re-enable follow: scroll current path into view even if path unchanged. */
function revealPath(path: string) {
  preserveScrollForPath = null
  forceRevealPath(path)
}

function onChevronClick(e: MouseEvent, path: string) {
  e.stopPropagation()
  emit('toggle', path)
}

function onFileClick(entry: FileEntry, e: MouseEvent) {
  if (e.detail > 1) return
  focusRow(entry.path)
  toggleSelect(entry, e)
}

function downloadSelected() {
  const entries = selectedFileEntries.value
  if (entries.length === 0) return
  emit('downloadMany', entries)
  clearSelection()
}

function deleteSelected() {
  const entries = selectedFileEntries.value
  if (entries.length === 0) return
  emit('deleteMany', entries)
  clearSelection()
}

function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    searchQuery.value = ''
    nextTick(() => {
      searchInputRef?.focus()
      searchInputRef?.select()
    })
  } else {
    searchQuery.value = ''
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') toggleSearch()
}

const { handleKeydown } = useSftpTreeKeyboard({
  visibleRows,
  focusedPath,
  isExpanded: (path) => props.isExpanded(path),
  isCurrent,
  canEdit: (name) => props.canEdit?.(name) ?? false,
  selectedFileEntries: () => selectedFileEntries.value,
  focusRow,
  toggleSelect: (entry) => toggleSelect(entry),
  showMoreFiles,
  toggleSearch,
  onSelectDir: (path) => emit('selectDir', path),
  onToggleDir: (path) => emit('toggle', path),
  onEdit: (entry) => emit('edit', entry),
  onRename: (entry) => emit('rename', entry),
  onDeleteMany: (entries) => emit('deleteMany', entries),
})

watch(
  () => props.currentPath,
  (path) => {
    // 不清空选中，用户可能跨目录选文件；仅关搜索
    searchQuery.value = ''
    searchVisible.value = false
    focusedPath.value = path
    // One-shot: this path change was caused by a row click under the cursor
    if (preserveScrollForPath && cleanPath(preserveScrollForPath) === cleanPath(path)) {
      preserveScrollForPath = null
      scheduleRestoreTreeScroll()
      return
    }
    preserveScrollForPath = null
    // Terminal follow / path jump: expand then scroll current dir into view
    requestRevealPath(path)
  },
)

watch(
  visibleRows,
  () => {
    // Tree height changes when empty folder loads or ancestors expand
    if (hasPendingReveal()) {
      tryRevealPendingPath()
      return
    }
    scheduleRestoreTreeScroll()
  },
)

defineExpose({ toggleSearch, handleKeydown, clearSelection, revealPath })
</script>

<template>
  <div
    ref="explorerRef"
    class="sftp-explorer"
    :class="{ 'external-drag': externalDragActive }"
    tabindex="0"
    :title="t('sftp.treeNavHint')"
    @keydown="handleKeydown"
    @dragover="onTreeBackgroundDragOver"
    @dragleave="onTreeDragLeave"
  >
    <div v-if="searchVisible" class="file-search-bar">
      <AppIcon name="search" size="xs" />
      <input
        :ref="setSearchInputRef"
        v-model="searchQuery"
        class="file-search-input"
        :placeholder="t('sftp.searchInTree')"
        @keydown="onSearchKeydown"
      />
      <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('sftp.closeSearch')" @click="toggleSearch">
        <AppIcon name="close" size="xs" />
      </button>
    </div>

    <div v-if="error" class="sidebar-error">
      <div class="sidebar-error-text">{{ error }}</div>
      <button type="button" class="sidebar-error-retry" @click="emit('retry')">{{ t('sftp.retry') }}</button>
    </div>

    <div v-if="selectedCount > 0" class="file-selection-bar">
      <span>{{ t('sftp.selectedCount', { count: selectedCount }) }}</span>
      <div class="file-selection-actions">
        <button type="button" class="file-selection-btn" @click="downloadSelected">{{ t('sftp.batchDownload') }}</button>
        <button type="button" class="file-selection-btn danger" @click="deleteSelected">{{ t('sftp.delete') }}</button>
        <button type="button" class="file-selection-btn ghost" @click="clearSelection">{{ t('common.cancel') }}</button>
      </div>
    </div>

    <div ref="treeScrollRef" class="sftp-dir-tree" role="tree" :aria-label="t('sftp.treeAria')">
      <div
        v-if="loading && visibleRows.length === 0"
        class="tree-loading"
      >
        <div v-for="index in 6" :key="index" class="tree-skeleton-row">
          <span class="tree-skeleton-icon"></span>
          <span class="tree-skeleton-name" :style="{ width: `${42 + (index % 3) * 16}%` }"></span>
        </div>
      </div>

      <div
        v-else-if="!loading && !error && visibleRows.length === 0"
        class="tree-empty"
      >
        <p class="tree-empty-title">{{ t('sftp.emptyDirTitle') }}</p>
        <p class="tree-empty-desc">{{ t('sftp.emptyDirDesc') }}</p>
      </div>

      <div
        v-for="row in visibleRows"
        :key="row.kind + ':' + row.path"
        :ref="(el) => setRowRef(el, row.path)"
        class="tree-row"
        :class="{
          dir: row.kind === 'dir',
          file: row.kind === 'file',
          more: row.kind === 'more',
          current: row.kind === 'dir' && isCurrent(row.path),
          branch: row.kind === 'dir' && isOnActiveBranch(row.path) && !isCurrent(row.path),
          selected: row.kind === 'file' && selectedPaths.has(row.path),
          loading: row.kind === 'dir' && isLoading(row.path),
          focused: focusedPath === row.path,
          'drop-target': externalDragActive && row.kind === 'dir' && dropTargetPath === row.path,
        }"
        :style="{ paddingLeft: `${8 + row.depth * 11}px` }"
        :title="row.kind === 'more' ? t('sftp.moreFilesHidden', { count: row.total - row.shown }) : (externalDragActive && row.kind === 'dir' ? t('sftp.uploadToPath', { path: row.path }) : row.path)"
        @click="row.kind === 'dir' ? onDirClick(row.path) : row.kind === 'file' ? onFileClick(row.entry, $event) : onMoreClick(row, $event)"
        @contextmenu="row.kind !== 'more' && row.entry && emit('contextMenu', $event, row.entry)"
        @dragover="row.kind === 'dir' ? onDirDragOver($event, row.path) : undefined"
      >
        <!-- 继续加载：目录文件过多时分页 -->
        <template v-if="row.kind === 'more'">
          <span class="tree-select-slot" aria-hidden="true"></span>
          <div class="tree-more">
            <span class="tree-more-text">{{ t('sftp.filesShownHidden', { shown: row.shown, total: row.total, hidden: row.total - row.shown }) }}</span>
            <div class="tree-more-actions">
              <button type="button" class="tree-more-btn" @click="onMoreClick(row, $event)">
                {{ t('sftp.showMore', { count: INITIAL_FILE_LIMIT }) }}
              </button>
              <button type="button" class="tree-more-btn" @click="onShowAllClick(row, $event)">
                {{ t('sftp.showAll') }}
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <!-- 文件夹：展开箭头 -->
          <button
            v-if="row.kind === 'dir'"
            type="button"
            class="tree-chevron"
            :class="{ open: isExpanded(row.path) }"
            :title="isExpanded(row.path) ? t('sftp.collapse') : t('sftp.expand')"
            @click="onChevronClick($event, row.path)"
          >
            <AppIcon name="chevron-right" size="xs" />
          </button>
          <!-- 文件：复选框，无箭头 -->
          <span v-else class="tree-select-slot">
            <input
              v-if="selectedCount > 0"
              type="checkbox"
              class="tree-check"
              :checked="selectedPaths.has(row.path)"
              @click.stop="toggleSelect(row.entry, $event)"
            />
          </span>

          <span class="tree-icon" aria-hidden="true">
            <FileTypeIcon
              :name="row.name"
              :is-directory="row.kind === 'dir'"
              :is-symlink="!!row.entry?.isSymlink"
            />
          </span>
          <span class="tree-name">{{ row.name }}</span>
          <span v-if="row.kind === 'dir' && isLoading(row.path)" class="tree-spin" :aria-label="t('sftp.loading')"></span>
          <span
            v-else-if="row.kind === 'file' && row.entry.size > 0"
            class="tree-size"
          >{{ formatSize(row.entry.size) }}</span>
          <div v-if="row.kind === 'file'" class="tree-quick-actions">
            <button type="button" class="tree-quick-btn" :title="t('sftp.download')" @click.stop="emit('download', row.entry)">
              <AppIcon name="download" size="xs" />
            </button>
            <button v-if="canEdit?.(row.name)" type="button" class="tree-quick-btn" :title="t('sftp.edit')" @click.stop="emit('edit', row.entry)">
              <AppIcon name="edit" size="xs" />
            </button>
          </div>
        </template>
      </div>
    </div>
    <div class="tree-status-bar">
      <span>
        {{ t('sftp.stats', { dirs: directoryCount, files: fileCount }) }}
        <template v-if="hiddenFileTotal > 0">{{ t('sftp.moreHidden', { count: hiddenFileTotal }) }}</template>
      </span>
      <span v-if="selectedCount">{{ t('sftp.selectedShort', { count: selectedCount }) }}</span>
      <span v-if="activeTransfers">{{ t('sftp.transferring', { count: activeTransfers }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.sftp-explorer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
  container-type: inline-size;
}

.sftp-dir-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 8px;
  background: var(--bg-secondary);
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: var(--sftp-row-min-height, 1.75rem);
  padding-right: 8px;
  font-size: var(--sftp-row-font, 0.75rem);
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  position: relative;
  width: max-content;
  min-width: 100%;
}

.tree-row:hover {
  background: var(--hover-bg);
}

.sftp-explorer.external-drag .sftp-dir-tree {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 6px;
}

.tree-row.drop-target {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-secondary)) !important;
  box-shadow:
    inset 3px 0 0 var(--accent),
    inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 4px;
}

.tree-row.drop-target .tree-name {
  color: var(--accent);
  font-weight: 600;
}

.tree-row.current {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.tree-row.current::before {
  content: '';
  position: absolute;
  left: 2px;
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent);
}

.tree-row.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.tree-row.focused {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
}

.tree-chevron {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--sftp-icon-size, 1.125rem);
  height: var(--sftp-icon-size, 1.125rem);
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s;
}

.tree-chevron svg {
  width: 0.75em;
  height: 0.75em;
}

.tree-chevron.open {
  transform: rotate(90deg);
  color: var(--accent);
}

.tree-chevron:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.tree-select-slot {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tree-check {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.tree-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--sftp-icon-slot, 1.375rem);
  height: var(--sftp-icon-slot, 1.375rem);
}

.tree-name {
  min-width: 0;
  overflow: visible;
  white-space: nowrap;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: inherit;
}

.tree-spin {
  margin-left: auto;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--text-secondary) 28%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tree-spin 0.7s linear infinite;
}

@keyframes tree-spin {
  to { transform: rotate(360deg); }
}

.tree-size {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.tree-quick-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
  opacity: 0;
  pointer-events: none;
}

.tree-row:hover .tree-quick-actions,
.tree-row.focused .tree-quick-actions {
  opacity: 1;
  pointer-events: auto;
}

.tree-quick-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tree-quick-btn:hover {
  color: var(--accent);
  background: var(--bg-tertiary);
}

.tree-quick-btn svg {
  width: 14px;
  height: 14px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tree-row.more {
  cursor: default;
  min-height: auto;
  padding-top: 4px;
  padding-bottom: 6px;
  align-items: flex-start;
}

.tree-row.more:hover {
  background: transparent;
}

.tree-more {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  margin-right: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 72%, transparent);
  color: var(--text-secondary);
}

.tree-more-text {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
}

.tree-more-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tree-more-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}

.tree-more-btn:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
}

.tree-status-bar {
  min-height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

@container (max-width: 319px) {
  .tree-size {
    display: none;
  }
}

.tree-loading {
  padding: 4px 8px;
}

.tree-skeleton-row {
  height: var(--sftp-row-min-height, 1.75rem);
  display: flex;
  align-items: center;
  gap: 8px;
}

.tree-skeleton-icon,
.tree-skeleton-name {
  display: block;
  background: linear-gradient(90deg, var(--bg-tertiary), color-mix(in srgb, var(--bg-tertiary) 55%, var(--border-color)), var(--bg-tertiary));
  background-size: 200% 100%;
  animation: tree-shimmer 1.35s ease-in-out infinite;
}

.tree-skeleton-icon {
  width: var(--sftp-icon-size, 1.125rem);
  height: var(--sftp-icon-size, 1.125rem);
  border-radius: 5px;
}

.tree-skeleton-name {
  height: 9px;
  border-radius: 999px;
}

@keyframes tree-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.file-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 8px;
  padding: 0 8px;
  min-height: 32px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-primary);
  flex-shrink: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.file-search-bar:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.file-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  height: 30px;
}

.file-selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-size: 11px;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.file-selection-actions {
  display: flex;
  gap: 4px;
}

.file-selection-btn {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}

.file-selection-btn.danger {
  color: var(--danger, #e53e3e);
}

.file-selection-btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-secondary);
}

.tree-empty {
  padding: 28px 16px;
  text-align: center;
  color: var(--text-secondary);
}

.tree-empty-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.tree-empty-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  max-width: 240px;
  margin-inline: auto;
}

.sidebar-error {
  padding: 10px;
  flex-shrink: 0;
}

.sidebar-error-text {
  font-size: 12px;
  color: var(--danger, #e53e3e);
  margin-bottom: 6px;
  line-height: 1.45;
}

.sidebar-error-retry {
  font-size: 11px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
</style>
