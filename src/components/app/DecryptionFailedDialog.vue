<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DecryptionFailedData } from '@/composables/app/useSecurityDialogs'
import AppIcon from '@/components/icons/AppIcon.vue'

defineProps<{
  data: DecryptionFailedData | null
}>()

const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'dismiss'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="ui-modal-overlay decrypt-dialog-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="decrypt-fail-title"
    @click.self="emit('dismiss')"
  >
    <div class="ui-modal-card decrypt-dialog">
      <div class="dialog-header">
        <AppIcon name="lock" size="2xl" class="dialog-tone-icon danger" />
        <span id="decrypt-fail-title" class="dialog-title">{{ t('dialog.decryptFailedTitle') }}</span>
      </div>
      <div class="dialog-body">
        <p class="dialog-warning">
          <strong>{{ data?.message }}</strong>
        </p>
        <p class="dialog-note">
          {{ t('dialog.decryptFailedNote', { field: data?.field === 'privateKey' ? t('dialog.privateKey') : t('dialog.password') }) }}
        </p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="ui-btn dialog-btn" @click="emit('dismiss')">{{ t('common.later') }}</button>
        <button type="button" class="ui-btn ui-btn-primary dialog-btn" @click="emit('edit')">{{ t('dialog.resetPassword') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.decrypt-dialog-overlay {
  z-index: 10000;
}

.decrypt-dialog {
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

.dialog-tone-icon.danger {
  color: var(--danger);
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
  margin: 0 0 0;
  line-height: 1.4;
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
