<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TransferItem } from '../env.d.ts'
import { formatSize } from '../utils/format'
import { formatSpeed } from '../composables/useTransfers'

const { t } = useI18n()

const props = defineProps<{
  transfers: [string, TransferItem][]
  direction: 'download' | 'upload'
  emptyText: string
  getSpeed?: (id: string) => number
}>()

const emit = defineEmits<{
  (e: 'cancel', id: string): void
  (e: 'remove', id: string): void
  (e: 'openFolder', localPath: string): void
  (e: 'resume', id: string): void
}>()

function getProgress(item: TransferItem): number {
  return item.total ? Math.min(100, Math.round(item.transferred / item.total * 100)) : 0
}

function canResume(item: TransferItem): boolean {
  return item.status === 'error' && !!item.localPath && (item.direction === 'download' ? !!item.remotePath : !!item.remotePath)
}

function onDragStart(e: DragEvent, item: TransferItem) {
  if (item.status !== 'completed' || item.direction !== 'download' || !item.localPath) {
    e.preventDefault()
    return
  }
  // Prefer native Electron drag for OS explorer drop
  e.preventDefault()
  window.LiteConnect.sftpStartDrag(item.localPath)
}
</script>

<template>
  <div v-if="transfers.length === 0" class="sidebar-empty" style="margin-top:40px">
    {{ emptyText }}
  </div>
  <div class="transfer-list">
    <div
      v-for="[id, item] in transfers"
      :key="id"
      class="transfer-item"
      :class="{
        'transfer-completed': item.status === 'completed',
        'transfer-error': item.status === 'error',
        'transfer-skipped': item.status === 'skipped',
        'transfer-partial': item.status === 'partial',
      }"
      :draggable="item.status === 'completed' && direction === 'download'"
      @click="item.status === 'completed' && direction === 'download' ? emit('openFolder', item.localPath) : undefined"
      @dragstart="onDragStart($event, item)"
    >
      <div class="transfer-info">
        <svg v-if="item.status === 'completed'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transfer-done-icon">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <svg v-else-if="item.status === 'skipped'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transfer-skip-icon">
          <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
        <svg v-else-if="item.status === 'uploading'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transfer-direction-icon">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transfer-file-icon">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <div class="transfer-text">
          <span class="transfer-name" :title="item.localPath">{{ item.fileName }}</span>
          <span v-if="item.status === 'downloading' || item.status === 'uploading'" class="transfer-detail">
            {{ formatSize(item.transferred) }} / {{ formatSize(item.total) }}
            <span v-if="getSpeed && getSpeed(id) > 0" class="transfer-speed">· {{ formatSpeed(getSpeed(id)) }}</span>
            <span
              v-if="item.totalFiles != null && item.totalFiles > 0"
              class="transfer-files"
            >· {{ item.completedFiles ?? 0 }}/{{ item.totalFiles }}{{ (item.failedFiles ?? 0) > 0 ? ` · ${item.failedFiles}✗` : '' }}</span>
          </span>
          <span v-else-if="item.status === 'completed'" class="transfer-detail transfer-detail-ok">
            {{ direction === 'download' ? t('sftp.transferDoneDownload') : t('sftp.transferDoneUpload') }}
          </span>
          <span v-else-if="item.status === 'partial'" class="transfer-detail transfer-detail-partial">
            {{ t('sftp.transferPartial', {
              ok: item.completedFiles ?? 0,
              failed: item.failedFiles ?? 0,
            }) }}
          </span>
          <span v-else-if="item.status === 'skipped'" class="transfer-detail transfer-detail-skip">
            {{ t('sftp.transferSkipped') }}
          </span>
          <span v-else class="transfer-detail transfer-detail-err">
            {{ item.error || t('sftp.transferError') }}
          </span>
        </div>
      </div>
      <div v-if="item.status === 'downloading' || item.status === 'uploading'" class="transfer-progress-col">
        <span class="transfer-percent">{{ getProgress(item) }}%</span>
        <div class="transfer-progress-bar">
          <div class="transfer-progress-fill" :style="{ width: getProgress(item) + '%' }"></div>
        </div>
      </div>
      <button
        v-if="item.status === 'downloading' || item.status === 'uploading'"
        class="transfer-action"
        @click.stop="emit('cancel', id)"
        :title="t('sftp.cancel')"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <button
        v-if="canResume(item)"
        class="transfer-action resume"
        @click.stop="emit('resume', id)"
        :title="t('sftp.resume')"
      >
        {{ t('sftp.resumeShort') }}
      </button>
      <button
        v-if="item.status === 'error' || item.status === 'skipped' || item.status === 'partial'"
        class="transfer-action"
        @click.stop="emit('remove', id)"
        :title="t('sftp.remove')"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.sidebar-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.transfer-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.transfer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  transition: background 0.15s;
}

.transfer-item:hover {
  background: var(--hover-bg);
}

.transfer-completed {
  cursor: grab;
}

.transfer-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.transfer-info > svg {
  width: 14px;
  height: 14px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.transfer-file-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
  margin-top: 1px;
}

.transfer-direction-icon {
  flex-shrink: 0;
  color: var(--accent);
  margin-top: 1px;
}

.transfer-done-icon {
  flex-shrink: 0;
  color: var(--success);
  margin-top: 1px;
}

.transfer-skip-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
  margin-top: 1px;
}

.transfer-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.transfer-name {
  font-size: 11px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-detail {
  font-size: 10px;
  color: var(--text-secondary);
}

.transfer-speed {
  color: var(--accent);
  font-weight: 600;
}

.transfer-files {
  color: var(--text-secondary);
}

.transfer-detail-ok {
  color: var(--success);
}

.transfer-detail-skip {
  color: var(--text-secondary);
}

.transfer-detail-partial {
  color: var(--warning, #d29922);
}

.transfer-partial .transfer-name {
  color: var(--warning, #d29922);
}

.transfer-detail-err {
  color: var(--danger);
}

.transfer-progress-col {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.transfer-percent {
  font-size: 10px;
  color: var(--text-secondary);
  min-width: 30px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.transfer-progress-bar {
  width: 50px;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.transfer-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease-out;
}

.transfer-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  transition: all 0.15s;
  font-size: 10px;
}

.transfer-action svg {
  width: 12px;
  height: 12px;
}

.transfer-action:hover {
  color: var(--danger);
  background: rgba(248, 81, 73, 0.15);
}

.transfer-action.resume {
  width: auto;
  padding: 0 4px;
  color: var(--accent);
  font-weight: 600;
}

.transfer-action.resume:hover {
  color: var(--accent);
  background: var(--accent-bg);
}
</style>
