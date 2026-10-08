<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SftpDirectoryPreview } from '@shared/types/sftp'
import { beginTransferBatch } from '@/composables/sftp/useTransfers'
const props = defineProps<{ visible: boolean; sessionId: string; remotePath: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'queued'): void }>()
const { t } = useI18n()
const preview = ref<SftpDirectoryPreview | null>(null)
const selected = ref<string[]>([])
const allowOverwrite = ref(false)
const busy = ref(false)
const error = ref('')
const modalRef = ref<HTMLElement | null>(null)
let sequence = 0
const candidates = computed(() => preview.value?.entries.filter(e => selected.value.includes(e.name) && (e.status === 'new' || (allowOverwrite.value && e.status === 'changed'))) || [])
async function compare(localPath?: string) {
  const sid = props.sessionId
  const target = props.remotePath
  const seq = ++sequence
  busy.value = true
  error.value = ''
  preview.value = null
  selected.value = []
  allowOverwrite.value = false
  try {
    const local = localPath || await window.LiteConnect.selectDirectory()
    if (!local || seq !== sequence) return
    const result = await window.LiteConnect.sftpDirectoryPreview(sid, local, target)
    if (seq !== sequence || sid !== props.sessionId || target !== props.remotePath) return
    preview.value = result
    selected.value = result.entries.filter(e => e.status === 'new').map(e => e.name)
    allowOverwrite.value = false
  } catch (err: unknown) {
    if (seq === sequence) error.value = err instanceof Error ? err.message : t('sftp.directorySyncFailure')
  } finally {
    if (seq === sequence) busy.value = false
  }
}
function statusLabel(status: string) {
  return ({ new: t('sftp.directorySyncStatusNew'), changed: t('sftp.directorySyncStatusChanged'), same: t('sftp.directorySyncStatusSame'), blocked: t('sftp.directorySyncStatusBlocked') } as Record<string, string>)[status]
}
function queueUpload() {
  if (busy.value || !preview.value || candidates.value.length === 0) return
  const sid = props.sessionId
  const items = candidates.value
  const ids = items.map(() => `sync-${crypto.randomUUID()}`)
  beginTransferBatch({ batchId: `sync-batch-${crypto.randomUUID()}`, sessionId: sid, direction: 'upload', transferIds: ids })
  items.forEach((item, i) => window.LiteConnect.sftpUpload(sid, item.localPath, preview.value!.remotePath, item.name, ids[i], { conflict: allowOverwrite.value ? 'overwrite' : 'skip' }))
  emit('queued')
  emit('close')
}
watch(() => [props.visible, props.sessionId, props.remotePath] as const, ([visible]) => {
  sequence++
  preview.value = null
  selected.value = []
  busy.value = false
  if (visible) {
    void nextTick(() => modalRef.value?.focus())
    void compare()
  }
}, { immediate: true })
</script>
<template>
  <div v-if="visible" class="sync-overlay" @click.self="emit('close')">
    <section ref="modalRef" tabindex="-1" class="sync-modal" @keydown.esc.stop.prevent="emit('close')" role="dialog" aria-modal="true" :aria-label="t('sftp.directorySync')">
      <h3>{{ t('sftp.directorySync') }}</h3>
      <p>{{ t('sftp.directorySyncScope') }}</p>
      <p v-if="preview" class="sync-path">{{ t('sftp.directorySyncTarget', { local: preview.localPath, remote: preview.remotePath }) }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="busy">{{ t('sftp.loadingEllipsis') }}</p>
      <div v-else-if="preview" class="sync-files">
        <label v-for="entry in preview.entries" :key="entry.name" class="sync-row">
          <input v-model="selected" type="checkbox" :value="entry.name" :disabled="entry.status === 'same' || entry.status === 'blocked' || (entry.status === 'changed' && !allowOverwrite)" />
          <span class="sync-name" :title="entry.name">{{ entry.name }}</span>
          <span>{{ statusLabel(entry.status) }}</span>
        </label>
        <p v-if="!preview.entries.length">{{ t('sftp.directorySyncEmpty') }}</p>
      </div>
      <p v-if="preview">{{ t('sftp.directorySyncSkipped', { count: preview.skipped }) }}</p>
      <label><input v-model="allowOverwrite" type="checkbox" :disabled="busy" /> {{ t('sftp.directorySyncOverwrite') }}</label>
      <footer>
        <button type="button" class="ui-btn ui-btn-sm" :disabled="busy" @click="compare(preview?.localPath)">{{ t('sftp.directorySyncRefresh') }}</button>
        <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="busy || !candidates.length" @click="queueUpload">{{ t('sftp.directorySyncUpload') }} ({{ candidates.length }})</button>
        <button type="button" class="ui-btn ui-btn-sm" @click="emit('close')">{{ t('common.close') }}</button>
      </footer>
    </section>
  </div>
</template>
<style scoped>
.sync-overlay { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,.45); display: grid; place-items: center; }
.sync-modal { width: min(720px, 90vw); max-height: 85vh; overflow: auto; padding: 20px; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 12px; }
.sync-path { overflow-wrap: anywhere; }
.sync-modal > p { margin: 8px 0; font-size: 12px; line-height: 1.5; }
.sync-modal > label { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-size: 12px; }
.sync-files { max-height: 40vh; overflow: auto; }
.sync-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.sync-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sync-row > span:last-child { flex-shrink: 0; font-size: 12px; }
footer { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin-top: 16px; }
</style>
