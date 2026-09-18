<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry, TransferConflictStrategy } from '../../env.d.ts'

const { t } = useI18n()

export type UploadItem = {
  name: string
  path: string
  isDirectory?: boolean
}

const props = defineProps<{
  visible: boolean
  files: UploadItem[]
  targetPath: string
  existingFiles?: FileEntry[]
}>()

const emit = defineEmits<{
  (e: 'confirm', conflict: TransferConflictStrategy): void
  (e: 'cancel'): void
}>()

const conflict = ref<TransferConflictStrategy>('rename')

watch(
  () => props.visible,
  (v) => {
    if (v) conflict.value = 'rename'
  },
)

function isOverwrite(fileName: string): boolean {
  return props.existingFiles?.some((f) => f.name === fileName) ?? false
}

const hasDirectory = () => props.files.some((f) => f.isDirectory)
const hasConflict = () => props.files.some((f) => isOverwrite(f.name))
</script>

<template>
  <div v-if="visible" class="ui-modal-overlay" @click.self="emit('cancel')">
    <div class="ui-modal-card upload-modal">
      <h3 class="modal-title">{{ t('sftp.confirmUpload') }}</h3>
      <p class="upload-confirm-text">
        {{ hasDirectory() ? t('sftp.uploadContentsTo') : t('sftp.uploadFilesTo') }}
      </p>
      <div class="ui-field upload-path-field">
        <span class="ui-field-text" :title="targetPath">{{ targetPath }}</span>
      </div>
      <ul class="upload-file-list">
        <li
          v-for="file in files"
          :key="file.path"
          :class="{ 'file-overwrite': isOverwrite(file.name) }"
        >
          <span class="upload-item-main">
            <span v-if="file.isDirectory" class="dir-badge">{{ t('sftp.folder') }}</span>
            <span class="upload-item-name" :title="file.path">{{ file.name }}</span>
          </span>
          <span v-if="isOverwrite(file.name)" class="overwrite-badge">
            {{ t('sftp.alreadyExists') }}
          </span>
        </li>
      </ul>

      <div class="conflict-section" :class="{ dim: !hasConflict() && !hasDirectory() }">
        <div class="conflict-title">
          {{ t('sftp.conflictStrategy') }}
          <span v-if="hasDirectory()" class="conflict-hint">{{ t('sftp.conflictHintDir') }}</span>
        </div>
        <label class="conflict-option">
          <input v-model="conflict" type="radio" value="rename" />
          <span>{{ t('sftp.conflictRename') }}</span>
        </label>
        <label class="conflict-option">
          <input v-model="conflict" type="radio" value="overwrite" />
          <span>{{ t('sftp.conflictOverwrite') }}</span>
        </label>
        <label class="conflict-option">
          <input v-model="conflict" type="radio" value="skip" />
          <span>{{ t('sftp.conflictSkip') }}</span>
        </label>
      </div>

      <div class="upload-confirm-actions">
        <button type="button" class="ui-btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="button" class="ui-btn ui-btn-primary" @click="emit('confirm', conflict)">{{ t('sftp.upload') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-modal {
  width: 420px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 22px;
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 14px;
}

.upload-confirm-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 8px;
}

.upload-path-field {
  margin-bottom: 12px;
  min-height: 36px;
  color: var(--accent);
}

.upload-path-field .ui-field-text {
  color: var(--accent);
  white-space: normal;
  word-break: break-all;
}

.upload-file-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px 0;
  max-height: 160px;
  overflow-y: auto;
}

.upload-file-list li {
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.upload-file-list li:last-child {
  border-bottom: none;
}

.upload-item-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.upload-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.file-overwrite {
  color: var(--danger);
}

.overwrite-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  color: var(--danger);
  font-weight: 600;
  flex-shrink: 0;
}

.conflict-section {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  padding: 10px 12px;
  margin-bottom: 16px;
  background: var(--bg-primary);
}

.conflict-section.dim {
  opacity: 0.75;
}

.conflict-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.conflict-hint {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: 11px;
}

.conflict-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 3px 0;
  cursor: pointer;
}

.upload-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
