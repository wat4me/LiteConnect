<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'

const props = defineProps<{
  draft: SettingsDraft
  recentDownloadPaths: string[]
  systemDefaultDownloadPath: string
}>()

const { t } = useI18n()

async function selectDownloadDirectory() {
  const dir = await window.LiteConnect.selectDirectory()
  if (dir) {
    props.draft.downloadPath = dir
    props.draft.useSystemDownloadPath = false
  }
}

/** 下载路径单独：改回系统「下载」文件夹（未保存前仅改草稿） */
function resetDownloadPathToSystem() {
  props.draft.downloadPath = props.systemDefaultDownloadPath
  props.draft.useSystemDownloadPath = true
}

function pickRecentPath(dir: string) {
  props.draft.downloadPath = dir
  props.draft.useSystemDownloadPath = dir === props.systemDefaultDownloadPath
}

async function addRecentPath() {
  const dir = await window.LiteConnect.selectDirectory()
  if (dir) {
    props.draft.downloadPath = dir
    props.draft.useSystemDownloadPath = false
  }
}
</script>

<template>
  <section class="settings-content" data-setting="files">
    <header class="content-header">
      <h3>{{ t('settingsFiles.title') }}</h3>
      <p>{{ t('settingsFiles.intro') }}</p>
    </header>

    <div class="settings-card narrow">
      <div class="settings-label" data-setting="files.downloadPath">{{ t('settingsFiles.downloadPath') }}</div>
      <div class="download-path-row">
        <div class="ui-field download-path-field" :title="draft.downloadPath || systemDefaultDownloadPath || ''">
          <span class="ui-field-text">
            {{ draft.downloadPath || systemDefaultDownloadPath || '…' }}
          </span>
        </div>
        <button type="button" class="ui-btn ui-btn-sm" @click="selectDownloadDirectory">{{ t('settingsFiles.browse') }}</button>
        <button
          type="button"
          class="ui-btn ui-btn-sm"
          :disabled="draft.useSystemDownloadPath"
          :title="t('settingsFiles.resetDownloadTitle')"
          @click="resetDownloadPathToSystem"
        >
          {{ t('settingsFiles.systemDefault') }}
        </button>
      </div>
      <div class="settings-hint">
        <template v-if="draft.useSystemDownloadPath">
          {{ t('settingsFiles.usingSystemDownload') }}
          <span v-if="systemDefaultDownloadPath" class="path-inline">（{{ systemDefaultDownloadPath }}）</span>
        </template>
        <template v-else>
          {{ t('settingsFiles.usingCustomDownload') }}
        </template>
      </div>
      <div v-if="recentDownloadPaths.length" class="recent-paths">
        <button
          v-for="p in recentDownloadPaths"
          :key="p"
          type="button"
          class="recent-path-item"
          :class="{ active: !draft.useSystemDownloadPath && draft.downloadPath === p }"
          :title="p"
          @click="pickRecentPath(p)"
        >
          {{ p }}
        </button>
      </div>
      <button type="button" class="add-path-btn" @click="addRecentPath">{{ t('settingsFiles.addDownloadPath') }}</button>

      <div class="settings-label" style="margin-top: 16px" data-setting="files.conflictStrategy">{{ t('settingsFiles.conflictStrategy') }}</div>
      <select v-model="draft.downloadConflictStrategy" class="settings-select">
        <option value="rename">{{ t('settingsFiles.conflictRename') }}</option>
        <option value="overwrite">{{ t('settingsFiles.conflictOverwrite') }}</option>
        <option value="skip">{{ t('settingsFiles.conflictSkip') }}</option>
      </select>
      <div class="settings-hint">
        {{ t('settingsFiles.conflictHint') }}
      </div>

      <div class="settings-label" style="margin-top: 16px" data-setting="files.dirTransferConcurrency">{{ t('settingsFiles.dirTransferConcurrency') }}</div>
      <select v-model.number="draft.dirTransferConcurrency" class="settings-select">
        <option v-for="n in 8" :key="n" :value="n">{{ n }}</option>
      </select>
      <div class="settings-hint">{{ t('settingsFiles.dirTransferConcurrencyHint') }}</div>

      <div class="settings-label" style="margin-top: 16px" data-setting="files.dirTransferFailPolicy">{{ t('settingsFiles.dirTransferFailPolicy') }}</div>
      <select v-model="draft.dirTransferFailPolicy" class="settings-select">
        <option value="stop">{{ t('settingsFiles.dirFailStop') }}</option>
        <option value="continue">{{ t('settingsFiles.dirFailContinue') }}</option>
      </select>
      <div class="settings-hint">{{ t('settingsFiles.dirTransferFailPolicyHint') }}</div>
    </div>
  </section>
</template>

<style scoped>
.download-path-row {
  margin-bottom: 8px;
}

.download-path-field {
  flex: 1;
  min-width: 0;
  min-height: var(--control-h-sm, 32px);
}

.path-inline {
  word-break: break-all;
  opacity: 0.9;
}

.recent-paths {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  max-height: 120px;
  overflow-y: auto;
}

.recent-path-item {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-path-item:hover {
  color: var(--text-primary);
  border-color: var(--border-color);
}

.recent-path-item.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.add-path-btn {
  border: 1px dashed var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 8px;
  width: 100%;
  font-size: 12px;
  cursor: pointer;
}

.add-path-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
