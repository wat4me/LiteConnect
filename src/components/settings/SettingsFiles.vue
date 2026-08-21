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
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsFiles.title') }}</h3>
      <p>{{ t('settingsFiles.intro') }}</p>
    </header>

    <div class="settings-card narrow">
      <div class="settings-label">{{ t('settingsAppearance.downloadPath') }}</div>
      <div class="download-path-row">
        <div class="ui-field download-path-field" :title="draft.downloadPath || systemDefaultDownloadPath || ''">
          <span class="ui-field-text">
            {{ draft.downloadPath || systemDefaultDownloadPath || '…' }}
          </span>
        </div>
        <button type="button" class="ui-btn ui-btn-sm" @click="selectDownloadDirectory">{{ t('settingsAppearance.browse') }}</button>
        <button
          type="button"
          class="ui-btn ui-btn-sm"
          :disabled="draft.useSystemDownloadPath"
          :title="t('settingsAppearance.resetDownloadTitle')"
          @click="resetDownloadPathToSystem"
        >
          {{ t('settingsAppearance.systemDefault') }}
        </button>
      </div>
      <div class="settings-hint">
        <template v-if="draft.useSystemDownloadPath">
          {{ t('settingsAppearance.usingSystemDownload') }}
          <span v-if="systemDefaultDownloadPath" class="path-inline">（{{ systemDefaultDownloadPath }}）</span>
        </template>
        <template v-else>
          {{ t('settingsAppearance.usingCustomDownload') }}
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
      <button type="button" class="add-path-btn" @click="addRecentPath">{{ t('settingsAppearance.addDownloadPath') }}</button>

      <div class="settings-label" style="margin-top: 16px">{{ t('settingsAppearance.conflictStrategy') }}</div>
      <select v-model="draft.downloadConflictStrategy" class="settings-select">
        <option value="rename">{{ t('settingsAppearance.conflictRename') }}</option>
        <option value="overwrite">{{ t('settingsAppearance.conflictOverwrite') }}</option>
        <option value="skip">{{ t('settingsAppearance.conflictSkip') }}</option>
      </select>
      <div class="settings-hint">
        {{ t('settingsAppearance.conflictHint') }}
      </div>

      <div class="settings-label" style="margin-top: 16px">{{ t('settingsAppearance.dirTransferConcurrency') }}</div>
      <select v-model.number="draft.dirTransferConcurrency" class="settings-select">
        <option v-for="n in 8" :key="n" :value="n">{{ n }}</option>
      </select>
      <div class="settings-hint">{{ t('settingsAppearance.dirTransferConcurrencyHint') }}</div>

      <div class="settings-label" style="margin-top: 16px">{{ t('settingsAppearance.dirTransferFailPolicy') }}</div>
      <select v-model="draft.dirTransferFailPolicy" class="settings-select">
        <option value="stop">{{ t('settingsAppearance.dirFailStop') }}</option>
        <option value="continue">{{ t('settingsAppearance.dirFailContinue') }}</option>
      </select>
      <div class="settings-hint">{{ t('settingsAppearance.dirTransferFailPolicyHint') }}</div>
    </div>
  </section>
</template>

<style scoped>
.content-header {
  margin-bottom: 20px;
  max-width: 720px;
}

.content-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text-primary);
}

.content-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.settings-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 16px;
}

.settings-card.narrow {
  max-width: 560px;
}

.settings-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.download-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* .settings-select surface styles live in main.css (shared with .ui-select) */

.settings-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.45;
}
</style>
