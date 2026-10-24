<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { uploadConflictRequest } from '@/composables/sftp/useTransfers'
import type { TransferConflictStrategy } from '@shared/types/sftp'

const { t } = useI18n()
const action = ref<TransferConflictStrategy>('rename')
const applyToAll = ref(false)
const sending = ref(false)
const firstOption = ref<HTMLInputElement | null>(null)
let previousFocus: HTMLElement | null = null

watch(() => uploadConflictRequest.value?.requestId, async (_id, previousId) => {
  action.value = 'rename'
  applyToAll.value = false
  sending.value = false
  if (uploadConflictRequest.value) {
    if (!previousId) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    firstOption.value?.focus()
  } else {
    await nextTick()
    if (!uploadConflictRequest.value && previousFocus?.isConnected) previousFocus.focus()
  }
})

function respond(cancel = false) {
  const request = uploadConflictRequest.value
  if (!request || sending.value) return
  sending.value = true
  window.LiteConnect.resolveUploadConflict(request.requestId, {
    action: cancel ? 'cancel' : action.value,
    applyToAll: applyToAll.value,
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); respond(true) }
  // Keep keyboard focus in the modal instead of the terminal beneath it.
  if (event.key === 'Tab') {
    const root = event.currentTarget as HTMLElement
    const elements = [...root.querySelectorAll<HTMLElement>('input:checked, input[type="checkbox"], button:not(:disabled)')]
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="uploadConflictRequest" class="ui-modal-overlay upload-conflict-overlay" role="dialog" aria-modal="true" aria-labelledby="upload-conflict-title" @keydown.stop="onKeydown">
      <div class="ui-modal-card upload-conflict-dialog">
        <h3 id="upload-conflict-title">{{ t('sftp.uploadConflictTitle') }}</h3>
        <p>{{ t('sftp.uploadConflictHint') }}</p>
        <dl>
          <template v-if="uploadConflictRequest.hostName"><dt>{{ t('sftp.uploadConflictHost') }}</dt><dd>{{ uploadConflictRequest.hostName }}</dd></template>
          <dt>{{ t('sftp.uploadConflictSource') }}</dt><dd>{{ uploadConflictRequest.localPath }}</dd>
          <dt>{{ t('sftp.uploadConflictTarget') }}</dt><dd>{{ uploadConflictRequest.remotePath }}</dd>
        </dl>
        <div class="upload-conflict-options">
          <label><input ref="firstOption" v-model="action" type="radio" value="rename" name="upload-conflict-action" />{{ t('sftp.uploadConflictRename') }}</label>
          <label><input v-model="action" type="radio" value="overwrite" name="upload-conflict-action" />{{ t('sftp.uploadConflictOverwrite') }}</label>
          <label><input v-model="action" type="radio" value="skip" name="upload-conflict-action" />{{ t('sftp.uploadConflictSkip') }}</label>
        </div>
        <label class="upload-conflict-remember"><input v-model="applyToAll" type="checkbox" />{{ t('sftp.uploadConflictApplyAll') }}</label>
        <div class="upload-conflict-actions">
          <button type="button" class="ui-btn" :disabled="sending" @click="respond(true)">{{ t('sftp.uploadConflictCancelBatch') }}</button>
          <button type="button" class="ui-btn ui-btn-primary" :disabled="sending" @click="respond()">{{ t('sftp.uploadConflictContinue') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.upload-conflict-overlay { z-index: 11000; }
.upload-conflict-dialog { width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 80px); overflow: auto; padding: 20px; color: var(--text-primary); -webkit-app-region: no-drag; }
h3 { margin: 0 0 10px; font-size: 16px; }
p { margin: 0 0 14px; font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 12px; padding: 12px; margin: 0 0 14px; background: var(--bg-secondary); border-radius: 8px; font-size: 12px; }
dt { color: var(--text-secondary); }
dd { margin: 0; overflow-wrap: anywhere; }
.upload-conflict-options { display: flex; flex-direction: column; gap: 10px; padding: 12px 0; border-block: 1px solid var(--border-color); }
label { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; line-height: 1.5; }
input { flex-shrink: 0; accent-color: var(--accent); }
.upload-conflict-remember { margin: 14px 0; color: var(--text-secondary); }
.upload-conflict-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
</style>
