<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../env.d.ts'

defineProps<{
  visible: boolean
  x: number
  y: number
  entry: FileEntry | null
  canEdit: (name: string) => boolean
  isArchive: (name: string) => boolean
}>()

const emit = defineEmits<{
  (e: 'open', entry: FileEntry): void
  (e: 'download', entry: FileEntry): void
  (e: 'download-to', entry: FileEntry): void
  (e: 'download-dir', entry: FileEntry): void
  (e: 'extract', entry: FileEntry): void
  (e: 'edit', entry: FileEntry): void
  (e: 'rename', entry: FileEntry): void
  (e: 'properties', entry: FileEntry): void
  (e: 'delete', entry: FileEntry): void
}>()

const { t } = useI18n()
</script>

<template>
  <div
    v-if="visible && entry"
    class="context-menu"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
  >
    <button
      v-if="entry.isDirectory"
      type="button"
      class="context-menu-item"
      @click="emit('open', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span>{{ t('sftp.open') }}</span>
    </button>
    <button
      v-if="!entry.isDirectory"
      type="button"
      class="context-menu-item"
      @click="emit('download', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>{{ t('sftp.download') }}</span>
    </button>
    <button
      v-if="!entry.isDirectory"
      type="button"
      class="context-menu-item"
      @click="emit('download-to', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span>{{ t('sftp.downloadTo') }}</span>
    </button>
    <button
      v-if="!entry.isDirectory && isArchive(entry.name)"
      type="button"
      class="context-menu-item"
      @click="emit('extract', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
      </svg>
      <span>{{ t('sftp.extractRemote') }}</span>
    </button>
    <button
      v-if="entry.isDirectory"
      type="button"
      class="context-menu-item"
      @click="emit('download-dir', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>{{ t('sftp.downloadFolder') }}</span>
    </button>
    <button
      v-if="!entry.isDirectory && canEdit(entry.name)"
      type="button"
      class="context-menu-item"
      @click="emit('edit', entry)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span>{{ t('sftp.edit') }}</span>
    </button>
    <button type="button" class="context-menu-item" @click="emit('rename', entry)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>
      <span>{{ t('sftp.rename') }}</span>
    </button>
    <button type="button" class="context-menu-item" @click="emit('properties', entry)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span>{{ t('sftp.properties') }}</span>
    </button>
    <button type="button" class="context-menu-item danger" @click="emit('delete', entry)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
      <span>{{ t('sftp.delete') }}</span>
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 10000;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  padding: 4px 0;
  min-width: 140px;
  max-height: calc(100vh - 8px);
  overflow-y: auto;
}

.context-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.context-menu-item svg {
  flex-shrink: 0;
  opacity: 0.85;
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item:hover {
  background: var(--accent-bg);
  color: var(--accent);
}
</style>
