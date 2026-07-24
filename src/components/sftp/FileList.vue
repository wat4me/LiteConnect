<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../env.d.ts'
import { formatSize } from '../utils/format'
import FileTypeIcon from './FileTypeIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  files: FileEntry[]
  currentPath: string
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  (e: 'navigate', entry: FileEntry): void
  (e: 'goUp'): void
  (e: 'download', entry: FileEntry): void
  (e: 'downloadMany', entries: FileEntry[]): void
  (e: 'deleteMany', entries: FileEntry[]): void
  (e: 'contextMenu', event: MouseEvent, entry: FileEntry): void
  (e: 'retry'): void
}>()

const INITIAL_FILE_LIMIT = 50
const fileLimit = ref(INITIAL_FILE_LIMIT)
const searchQuery = ref('')
const searchVisible = ref(false)
const selectedPaths = ref<Set<string>>(new Set())
let searchInputRef: HTMLInputElement | null = null
let lastClickedPath: string | null = null

const setSearchInputRef = (el: any) => {
  searchInputRef = el as HTMLInputElement | null
}

const filteredFiles = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.files
  return props.files.filter(entry =>
    entry.name.toLowerCase().includes(query)
  )
})

const directories = computed(() => filteredFiles.value.filter(entry => entry.isDirectory))
const regularFiles = computed(() => filteredFiles.value.filter(entry => !entry.isDirectory))
const visibleFiles = computed(() => regularFiles.value.slice(0, fileLimit.value))
const hiddenFileCount = computed(() => Math.max(0, regularFiles.value.length - visibleFiles.value.length))
const visibleEntries = computed(() => [...directories.value, ...visibleFiles.value])
const isSearching = computed(() => searchQuery.value.trim().length > 0)

const selectedCount = computed(() => selectedPaths.value.size)

const selectedFileEntries = computed(() =>
  props.files.filter((f) => selectedPaths.value.has(f.path) && isSelectableFile(f)),
)

function isSelectableFile(entry: FileEntry): boolean {
  return !entry.isDirectory
}

function isSelected(path: string): boolean {
  return selectedPaths.value.has(path)
}

function toggleSelect(entry: FileEntry, e?: MouseEvent) {
  if (!isSelectableFile(entry)) return
  const next = new Set(selectedPaths.value)
  if (e?.shiftKey && lastClickedPath) {
    const list = visibleEntries.value.filter(isSelectableFile)
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

function clearSelection() {
  selectedPaths.value = new Set()
  lastClickedPath = null
}

function downloadSelected() {
  const entries = selectedFileEntries.value
  if (entries.length === 0) return
  emit('downloadMany', entries)
  clearSelection()
}

function onEntryClick(entry: FileEntry, e: MouseEvent) {
  // Folders: no selection UI — only double-click to open
  if (!isSelectableFile(entry)) return
  // Ignore the second click of a double-click so selection is not toggled twice
  if (e.detail > 1) return
  toggleSelect(entry, e)
}

function onEntryDblClick(entry: FileEntry) {
  if (entry.isDirectory) {
    emit('navigate', entry)
  }
}

function deleteSelected() {
  // Only files can be multi-selected; folders use right-click delete
  const entries = selectedFileEntries.value
  if (entries.length === 0) return
  emit('deleteMany', entries)
  clearSelection()
}

function showMoreFiles() {
  fileLimit.value += INITIAL_FILE_LIMIT
}

function showAllFiles() {
  fileLimit.value = regularFiles.value.length
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
  if (e.key === 'Escape') {
    toggleSearch()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    e.stopPropagation()
    toggleSearch()
  }
}

watch(() => props.currentPath, () => {
  fileLimit.value = INITIAL_FILE_LIMIT
  searchQuery.value = ''
  searchVisible.value = false
  clearSelection()
})

defineExpose({ toggleSearch, handleKeydown, clearSelection })
</script>

<template>
  <div class="file-list-container" @keydown="handleKeydown" tabindex="0">
    <div v-if="searchVisible" class="file-search-bar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        :ref="setSearchInputRef"
        v-model="searchQuery"
        class="file-search-input"
        :placeholder="t('sftp.searchFilesPlaceholder')"
        @keydown="onSearchKeydown"
      />
      <span v-if="isSearching" class="search-count">{{ t('sftp.searchResultCount', { count: filteredFiles.length }) }}</span>
      <button class="file-search-close" @click="toggleSearch" :title="t('sftp.closeSearch')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div v-if="error" class="sidebar-error">
      <div class="sidebar-error-text">{{ error }}</div>
      <button class="sidebar-error-retry" @click="emit('retry')">{{ t('sftp.retry') }}</button>
    </div>

    <div v-if="loading && files.length === 0" class="sidebar-loading">
      <div class="file-skeleton-row" v-for="index in 8" :key="index">
        <span class="file-skeleton-icon"></span>
        <span class="file-skeleton-name" :style="{ width: `${48 + (index % 4) * 12}%` }"></span>
      </div>
    </div>

    <div v-if="selectedCount > 0" class="file-selection-bar">
      <span>{{ t('sftp.selectedCount', { count: selectedCount }) }}</span>
      <div class="file-selection-actions">
        <button
          v-if="selectedFileEntries.length > 0"
          type="button"
          class="file-selection-btn"
          @click="downloadSelected"
        >
          {{ t('sftp.batchDownload') }}
        </button>
        <button type="button" class="file-selection-btn danger" @click="deleteSelected">{{ t('sftp.delete') }}</button>
        <button type="button" class="file-selection-btn ghost" @click="clearSelection">{{ t('common.cancel') }}</button>
      </div>
    </div>

    <div class="file-list" v-if="!(loading && files.length === 0)">
      <div
        v-for="entry in visibleEntries"
        :key="entry.path"
        class="file-entry"
        :class="{
          'file-entry-dir': entry.isDirectory,
          selected: isSelectableFile(entry) && isSelected(entry.path),
        }"
        :title="entry.isDirectory ? t('sftp.doubleClickOpen') : undefined"
        @click="onEntryClick(entry, $event)"
        @dblclick="onEntryDblClick(entry)"
        @contextmenu="emit('contextMenu', $event, entry)"
      >
        <input
          v-if="isSelectableFile(entry)"
          type="checkbox"
          class="file-check"
          :checked="isSelected(entry.path)"
          @click.stop="toggleSelect(entry, $event)"
        />
        <span v-else class="file-check-spacer" aria-hidden="true"></span>
        <span class="file-icon-img">
          <FileTypeIcon
            :name="entry.name"
            :is-directory="entry.isDirectory"
            :is-symlink="entry.isSymlink"
          />
        </span>
        <span class="file-name" :title="entry.name">
          <template v-if="isSearching">
            <template v-for="(part, idx) in highlightMatch(entry.name, searchQuery)" :key="idx">
              <mark v-if="part.highlight" class="search-highlight">{{ part.text }}</mark>
              <span v-else>{{ part.text }}</span>
            </template>
          </template>
          <template v-else>{{ entry.name }}</template>
        </span>
        <span v-if="!entry.isDirectory && entry.size > 0" class="file-size">{{ formatSize(entry.size) }}</span>
      </div>

      <div v-if="hiddenFileCount > 0 && !isSearching" class="file-list-more">
        <span>{{ t('sftp.filesShownDirs', { dirs: directories.length, shown: visibleFiles.length, total: regularFiles.length }) }}</span>
        <div class="file-list-more-actions">
          <button class="file-list-more-btn" @click="showMoreFiles">{{ t('sftp.showMoreFiles', { count: INITIAL_FILE_LIMIT }) }}</button>
          <button class="file-list-more-btn" @click="showAllFiles">{{ t('sftp.showAllFiles') }}</button>
        </div>
      </div>

      <div v-if="isSearching && filteredFiles.length === 0" class="sidebar-empty">
        {{ t('sftp.noMatchFiles', { query: searchQuery }) }}
      </div>

      <div v-if="files.length === 0 && currentPath && !loading && !isSearching" class="sidebar-empty">
        <div class="sidebar-empty-icon">{{ t('sftp.emptyIcon') }}</div>
        <div>{{ t('sftp.emptyDir') }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
function highlightMatch(text: string, query: string): { text: string; highlight: boolean }[] {
  if (!query.trim()) return [{ text, highlight: false }]
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()
  const parts: { text: string; highlight: boolean }[] = []
  let lastIndex = 0
  let searchIndex = 0

  while (searchIndex < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, searchIndex)
    if (matchIndex === -1) break

    if (matchIndex > lastIndex) {
      parts.push({ text: text.slice(lastIndex, matchIndex), highlight: false })
    }
    parts.push({ text: text.slice(matchIndex, matchIndex + lowerQuery.length), highlight: true })
    lastIndex = matchIndex + lowerQuery.length
    searchIndex = lastIndex
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: false })
  }

  return parts.length > 0 ? parts : [{ text, highlight: false }]
}
</script>

<style scoped>
.file-list-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
}

.file-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.file-selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: var(--accent-bg);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border-color));
  font-size: 11px;
  color: var(--accent);
  flex-shrink: 0;
}

.file-selection-actions {
  display: flex;
  gap: 6px;
}

.file-selection-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.file-selection-btn.ghost {
  background: transparent;
  color: var(--accent);
}

.file-selection-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
}

.file-check {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.file-check-spacer {
  width: 13px;
  flex-shrink: 0;
}

.file-entry.selected {
  background: var(--accent-bg);
}

.file-search-bar svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.file-search-input {
  flex: 1;
  padding: 3px 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.file-search-input:focus {
  border-color: var(--accent);
}

.search-count {
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.file-search-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
}

.file-search-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.sidebar-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--danger);
  background: rgba(248, 81, 73, 0.1);
  margin: 6px 8px;
  border-radius: 7px;
}

.sidebar-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-error-retry {
  border: 1px solid rgba(248, 81, 73, 0.35);
  background: transparent;
  color: var(--danger);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.sidebar-error-retry:hover {
  background: rgba(248, 81, 73, 0.14);
}

.sidebar-loading {
  padding: 8px 10px;
}

.file-skeleton-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  margin: 1px 0;
}

.file-skeleton-icon,
.file-skeleton-name {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-tertiary), var(--hover-bg), var(--bg-tertiary));
  background-size: 200% 100%;
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}

.file-skeleton-icon {
  width: var(--sftp-icon-slot, 1.375rem);
  height: var(--sftp-icon-slot, 1.375rem);
  flex-shrink: 0;
}

.file-skeleton-name {
  height: 10px;
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.file-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.file-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: var(--sftp-row-font, 0.75rem);
  color: var(--text-primary);
  cursor: default;
  transition: background 0.12s, transform 0.12s;
  min-height: var(--sftp-row-min-height, 1.75rem);
  border-radius: 6px;
  margin: 1px 6px;
}

.file-entry-dir {
  cursor: pointer;
}

.file-entry:hover {
  background: var(--hover-bg);
  transform: translateX(1px);
}

.file-entry-parent:hover {
  background: var(--hover-bg);
}

.file-icon-img {
  flex-shrink: 0;
  width: var(--sftp-icon-slot, 1.375rem);
  height: var(--sftp-icon-slot, 1.375rem);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.file-icon-img-parent {
  color: var(--accent);
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-highlight {
  background: var(--accent);
  color: #fff;
  border-radius: 2px;
  padding: 0 1px;
}

.file-size {
  font-size: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.file-list-more {
  margin: 8px 10px 10px;
  padding: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.file-list-more-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.file-list-more-btn {
  border: none;
  background: var(--button-bg);
  color: var(--text-primary);
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

.file-list-more-btn:hover {
  background: var(--hover-bg);
}

.sidebar-empty {
  padding: 28px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sidebar-empty-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}
</style>
