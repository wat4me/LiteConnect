<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const props = defineProps<{
  aiActive: boolean
  filesActive: boolean
  monitorActive: boolean
  batchActive: boolean
  snippetsActive: boolean
  showAiUnread: boolean
  /** Active SFTP transfers (all sessions); shown when files panel closed */
  activeTransfers?: number
  /** Docker workspace mode button (not a side panel). */
  dockerActive?: boolean
  dockerDisabled?: boolean
  /** When Docker mode is on, side-panel buttons are inert. */
  sidePanelsDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-ai'): void
  (e: 'toggle-files'): void
  (e: 'toggle-monitor'): void
  (e: 'toggle-batch'): void
  (e: 'toggle-snippets'): void
  (e: 'toggle-docker'): void
}>()

const { t } = useI18n()

const dockerTooltip = computed(() => {
  if (props.dockerDisabled) return t('toolbar.dockerDisabled')
  if (props.dockerActive) return t('toolbar.dockerActive')
  return t('toolbar.dockerShortcut')
})
</script>

<template>
  <div class="left-toolbar" role="toolbar" :aria-label="t('toolbar.aria')">
    <el-tooltip :content="t('toolbar.aiShortcut')" placement="right" :show-after="300">
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: aiActive }"
        :aria-label="t('toolbar.ai')"
        :aria-pressed="aiActive"
        :disabled="sidePanelsDisabled"
        @click="emit('toggle-ai')"
      >
        <AppIcon name="ai-chat" size="lg" />
        <span
          v-if="showAiUnread"
          class="ai-reply-badge"
          :aria-label="t('toolbar.aiUnread')"
        ></span>
      </button>
    </el-tooltip>

    <el-tooltip
      :content="activeTransfers ? t('toolbar.sftpActive', { count: activeTransfers }) : t('toolbar.sftp')"
      placement="right"
      :show-after="300"
    >
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: filesActive }"
        :aria-label="activeTransfers ? t('toolbar.sftpAriaActive', { count: activeTransfers }) : t('toolbar.sftpAria')"
        :aria-pressed="filesActive"
        :disabled="sidePanelsDisabled"
        @click="emit('toggle-files')"
      >
        <AppIcon name="folder" size="lg" />
        <span
          v-if="!filesActive && activeTransfers && activeTransfers > 0"
          class="transfer-count-badge"
          :aria-label="t('toolbar.transferring', { count: activeTransfers })"
        >{{ activeTransfers > 99 ? '99+' : activeTransfers }}</span>
      </button>
    </el-tooltip>

    <el-tooltip :content="t('toolbar.monitorShortcut')" placement="right" :show-after="300">
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: monitorActive }"
        :aria-label="t('toolbar.monitor')"
        :aria-pressed="monitorActive"
        :disabled="sidePanelsDisabled"
        @click="emit('toggle-monitor')"
      >
        <AppIcon name="monitor" size="lg" />
      </button>
    </el-tooltip>

    <el-tooltip :content="t('toolbar.batchShortcut')" placement="right" :show-after="300">
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: batchActive }"
        :aria-label="t('toolbar.batch')"
        :aria-pressed="batchActive"
        :disabled="sidePanelsDisabled"
        @click="emit('toggle-batch')"
      >
        <AppIcon name="terminal" size="lg" />
      </button>
    </el-tooltip>

    <el-tooltip :content="t('toolbar.snippetsShortcut')" placement="right" :show-after="300">
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: snippetsActive }"
        :aria-label="t('toolbar.snippets')"
        :aria-pressed="snippetsActive"
        :disabled="sidePanelsDisabled"
        @click="emit('toggle-snippets')"
      >
        <AppIcon name="file-text" size="lg" />
      </button>
    </el-tooltip>

    <div class="toolbar-divider" role="separator" aria-hidden="true"></div>

    <el-tooltip :content="dockerTooltip" placement="right" :show-after="300">
      <button
        class="toolbar-icon-btn"
        type="button"
        :class="{ active: dockerActive }"
        :aria-label="t('toolbar.docker')"
        :aria-pressed="!!dockerActive"
        :disabled="dockerDisabled"
        @click="emit('toggle-docker')"
      >
        <AppIcon name="docker" size="lg" />
      </button>
    </el-tooltip>
  </div>
</template>

<style scoped>
.left-toolbar {
  width: var(--left-toolbar-width, 40px);
  min-width: var(--left-toolbar-width, 40px);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  gap: 4px;
}

.left-toolbar .app-icon:not([data-size]) {
  font-size: var(--icon-lg);
}

.toolbar-divider {
  width: 20px;
  height: 1px;
  margin: 4px 0;
  background: var(--border-color);
  flex-shrink: 0;
}

.toolbar-icon-btn {
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  position: relative;
}

.toolbar-icon-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.toolbar-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.toolbar-icon-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.toolbar-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-reply-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--bg-secondary);
  animation: ai-reply-pulse 1.6s ease-in-out infinite;
}

.transfer-count-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 1.5px var(--bg-secondary);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

@keyframes ai-reply-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.92); }
}
</style>
