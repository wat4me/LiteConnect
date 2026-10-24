<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import type { TransferItem } from '@shared/types/sftp'
import { useAiFileTransfers } from '@/composables/ai/useAiFileTransfers'
import { ensureTransferListeners, useTransfers } from '@/composables/sftp/useTransfers'
import AppIcon from '../icons/AppIcon.vue'
import TransferList from '../sftp/TransferList.vue'

const props = defineProps<{ sessionId: string; threadId: string; targets?: AiWorkspaceTarget[] }>()
const { t } = useI18n()
const { items, active, progress, clearFinished, cancel, remove, getSpeed } = useAiFileTransfers(() => props.sessionId, () => props.threadId, useTransfers(() => props.sessionId))
// App owns listener teardown. The fallback also supports an independently mounted AI panel.
onMounted(ensureTransferListeners)
const groups = computed(() => {
  const result = new Map<string, { key: string; name: string; direction: 'download' | 'upload'; entries: [string, TransferItem][] }>()
  for (const entry of items.value) {
    const item = entry[1]
    const key = JSON.stringify([item.sessionId, item.direction])
    let group = result.get(key)
    if (!group) {
      group = { key, name: props.targets?.find(target => target.sessionId === item.sessionId)?.name || item.origin?.hostName || t('ai.fileTransfersCurrentHost'), direction: item.direction, entries: [] }
      result.set(key, group)
    }
    group.entries.push(entry)
  }
  return [...result.values()]
})
function openFolder(path: string) { window.LiteConnect.shellShowItemInFolder(path) }
</script>

<template>
  <details v-if="items.length" class="ai-file-transfers" :class="{ running: active.length }">
    <summary :title="t('ai.fileTransfersHint')">
      <AppIcon name="transfer" size="sm" />
      <span class="transfer-heading">{{ t('ai.fileTransfersTitle') }}</span>
      <span class="transfer-summary">{{ active.length ? t('ai.fileTransfersRunning', { count: active.length }) : t('ai.fileTransfersFinished', { count: items.length }) }}</span>
      <span v-if="active.length && progress != null" class="transfer-summary-percent">{{ progress }}%</span>
      <AppIcon name="chevron-down" size="xs" />
    </summary>
    <div class="ai-transfer-body">
      <div v-for="group in groups" :key="group.key" class="ai-transfer-group">
        <h4 :title="group.name">{{ group.name }} · {{ t(group.direction === 'download' ? 'sftp.download' : 'sftp.upload') }}</h4>
        <TransferList :transfers="group.entries" :direction="group.direction" empty-text="" :get-speed="getSpeed" @cancel="cancel" @remove="remove" @open-folder="openFolder" />
      </div>
      <button v-if="items.length > active.length" type="button" class="ui-btn ui-btn-xs ui-btn-ghost transfer-clear-finished" @click="clearFinished">{{ t('ai.fileTransfersClearFinished') }}</button>
    </div>
  </details>
</template>

<style scoped>
.ai-file-transfers { flex-shrink: 0; min-width: 0; margin: 6px 12px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-secondary); font-size: var(--font-ui-sm); }
.ai-file-transfers.running { color: var(--accent); background: var(--accent-bg); }
summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; line-height: 1.4; }
summary::-webkit-details-marker { display: none; }
.transfer-heading { flex: 1; min-width: 0; }
.transfer-summary, .transfer-summary-percent { flex-shrink: 0; font-size: var(--font-caption); font-variant-numeric: tabular-nums; }
.ai-transfer-body { max-height: min(240px, 28vh); overflow: auto; overscroll-behavior: contain; margin-top: 6px; }
.ai-transfer-group { min-width: 0; }
h4 { margin: 6px 0 2px; font-size: var(--font-caption); font-weight: 500; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.transfer-clear-finished { margin-top: 4px; }
.ai-transfer-group :deep(.transfer-item) { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; padding-inline: 2px; }
.ai-transfer-group :deep(.transfer-detail) { overflow-wrap: anywhere; }
@container ai-sidebar (max-width: 420px) {
  .ai-transfer-group :deep(.transfer-item) { grid-template-columns: minmax(0, 1fr) auto; }
  .ai-transfer-group :deep(.transfer-info) { grid-column: 1 / -1; }
  .ai-transfer-group :deep(.transfer-progress-col) { grid-column: 1; justify-self: end; }
  .ai-transfer-group :deep(.transfer-action) { grid-column: 2; justify-self: end; }
}
</style>
