<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HostKeyMismatchData } from '../composables/useSecurityDialogs'

const props = defineProps<{
  data: HostKeyMismatchData | null
}>()

const emit = defineEmits<{
  (e: 'accept'): void
  (e: 'reject'): void
}>()

const { t } = useI18n()

const warningText = computed(() => {
  const d = props.data
  if (!d) return ''
  const isJump = d.role === 'jump'
  const isUnknown = !d.existingFingerprint
  if (isUnknown && isJump) {
    return t('dialog.hostKeyWarningUnknownJump', { host: d.host, port: d.port })
  }
  if (isUnknown) {
    return t('dialog.hostKeyWarningUnknown', { host: d.host, port: d.port })
  }
  if (isJump) {
    return t('dialog.hostKeyWarningJump', { host: d.host, port: d.port })
  }
  return t('dialog.hostKeyWarning', { host: d.host, port: d.port })
})
</script>

<template>
  <div
    class="ui-modal-overlay host-key-dialog-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="host-key-title"
    @click.self="emit('reject')"
  >
    <div class="ui-modal-card host-key-dialog">
      <div class="dialog-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span id="host-key-title" class="dialog-title">{{ t('dialog.hostKeyTitle') }}</span>
      </div>
      <div class="dialog-body">
        <p class="dialog-warning">
          {{ warningText }}
        </p>
        <p class="dialog-note">
          {{ t('dialog.hostKeyNote') }}
        </p>
        <div v-if="data?.existingFingerprint" class="fingerprint-row">
          <span class="fingerprint-label">{{ t('dialog.fingerprintOld') }}</span>
          <span class="fingerprint-value old">{{ data?.existingFingerprint }}</span>
        </div>
        <div class="fingerprint-row">
          <span class="fingerprint-label">{{
            data?.existingFingerprint ? t('dialog.fingerprintNew') : t('dialog.fingerprintCurrent')
          }}</span>
          <span class="fingerprint-value new">{{ data?.newFingerprint }}</span>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="ui-btn dialog-btn" @click="emit('reject')">{{ t('dialog.rejectConnect') }}</button>
        <button type="button" class="ui-btn ui-btn-primary dialog-btn" @click="emit('accept')">{{ t('dialog.trustAndConnect') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.host-key-dialog-overlay {
  z-index: 10000;
}

.host-key-dialog {
  width: 480px;
  max-width: 90vw;
  padding: 0;
  background: var(--bg-primary);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-body {
  padding: 16px 24px;
}

.dialog-warning {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0 0 8px;
  line-height: 1.5;
}

.dialog-note {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 16px;
  line-height: 1.4;
}

.fingerprint-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.fingerprint-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 48px;
}

.fingerprint-value {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  word-break: break-all;
}

.fingerprint-value.old {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
}

.fingerprint-value.new {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-color);
}

.dialog-btn {
  min-width: 96px;
}
</style>
