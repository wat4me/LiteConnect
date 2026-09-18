<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ConnectionFormModel } from './connectionFormTypes'

defineProps<{
  form: ConnectionFormModel
}>()

const { t } = useI18n()
</script>

<template>
  <div class="form-section">
    <div class="form-row">
      <label class="label">{{ t('connectionForm.keepalive') }}</label>
      <input v-model.number="form.keepaliveInterval" type="number" min="5" max="300" placeholder="30" class="ui-input input-narrow" />
      <div class="hint-text">{{ t('connectionForm.keepaliveHint') }}</div>
    </div>

    <div class="form-row panel">
      <label class="checkbox-row">
        <input v-model="form.useAgent" type="checkbox" />
        <span>{{ t('connectionForm.useAgent') }}</span>
      </label>
      <div class="hint-text">{{ t('connectionForm.useAgentHint') }}</div>
    </div>
  </div>
</template>
