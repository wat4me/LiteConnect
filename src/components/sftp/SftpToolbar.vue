<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

defineProps<{
  activeTransfers: number
  followTerminalPath: boolean
}>()

const emit = defineEmits<{
  (e: 'sync-cwd'): void
  (e: 'refresh'): void
  (e: 'search'): void
  (e: 'open-transfers'): void
  (e: 'upload-folder'): void
  (e: 'toggle-follow'): void
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="navigation-actions">
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('sftp.syncCwd')" @click="emit('sync-cwd')">
      <AppIcon name="sync" size="md" />
    </button>
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('sftp.refresh')" @click="emit('refresh')">
      <AppIcon name="refresh" size="md" />
    </button>
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('sftp.searchFiles')" @click="emit('search')">
      <AppIcon name="search" size="md" />
    </button>
    <button
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm transfer-action"
      :class="{ active: activeTransfers > 0 }"
      :title="activeTransfers > 0 ? t('sftp.transferListActive', { count: activeTransfers }) : t('sftp.transferList')"
      @click="emit('open-transfers')"
    >
      <AppIcon name="transfer" size="md" />
      <span v-if="activeTransfers > 0" class="transfer-action-badge">{{ activeTransfers > 99 ? '99+' : activeTransfers }}</span>
    </button>
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('sftp.uploadFolder')" @click="emit('upload-folder')">
      <AppIcon name="folder-up" size="md" />
    </button>
    <button
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
      :class="{ active: followTerminalPath }"
      :title="followTerminalPath ? t('sftp.followOn') : t('sftp.followOff')"
      @click="emit('toggle-follow')"
    >
      <AppIcon name="link-2" size="md" />
    </button>
    <div class="navigation-actions-spacer"></div>
    <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('sftp.closeSidebar')" @click="emit('close')">
      <AppIcon name="close" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.navigation-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 28px;
}

.navigation-actions-spacer {
  flex: 1;
  min-width: 4px;
}

.transfer-action {
  position: relative;
}

.transfer-action-badge {
  position: absolute;
  top: 1px;
  right: 0;
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
</style>
