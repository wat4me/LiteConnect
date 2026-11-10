<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import {
  DEFAULT_MONITOR_ALERT_RULE,
  isValidMonitorAlertRule,
  MONITOR_ALERT_MAX_NOTIFICATIONS,
  MONITOR_ALERT_MAX_THRESHOLD,
  MONITOR_ALERT_MIN_NOTIFICATIONS,
  MONITOR_ALERT_MIN_THRESHOLD,
  type MonitorAlertRule,
} from '../../../shared/monitorAlerts'

const props = defineProps<{
  open: boolean
  connectionName: string
  rule: MonitorAlertRule
  saving?: boolean
}>()
const emit = defineEmits<{
  (e: 'save', rule: MonitorAlertRule): void
  (e: 'close'): void
}>()

const { t } = useI18n()
const draft = ref<MonitorAlertRule>({ ...DEFAULT_MONITOR_ALERT_RULE })
const invalid = ref(false)
const isMacOs = ref(false)
const dialog = ref<HTMLElement>()

watch(
  () => props.open,
  async open => {
    if (!open) return
    draft.value = { ...props.rule }
    invalid.value = false
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('input, button')?.focus()
  },
  { immediate: true },
)

function submit() {
  if (!isValidMonitorAlertRule(draft.value)) {
    invalid.value = true
    return
  }
  invalid.value = false
  emit('save', {
    ...draft.value,
    backgroundEnabled: draft.value.enabled && draft.value.backgroundEnabled,
  })
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open || event.key !== 'Escape') return
  event.preventDefault()
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void window.LiteConnect.getAppInfo()
    .then(info => { isMacOs.value = info.platform.startsWith('darwin-') })
    .catch(() => {})
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="alert-overlay" @click.self="emit('close')">
      <form ref="dialog" class="alert-dialog" role="dialog" aria-modal="true" :aria-label="t('monitor.alertSettings')" @submit.prevent="submit">
        <div class="alert-header">
          <div class="alert-heading">
            <h2>{{ t('monitor.alertSettings') }}</h2>
            <span :title="connectionName">{{ connectionName }}</span>
          </div>
          <button type="button" class="alert-close" :aria-label="t('common.close')" @click="emit('close')">
            <AppIcon name="close" size="sm" />
          </button>
        </div>

        <label class="alert-toggle">
          <span>{{ t('monitor.alertEnabled') }}</span>
          <input v-model="draft.enabled" type="checkbox" />
        </label>
        <label class="alert-toggle alert-background-toggle">
          <span>{{ t('monitor.backgroundOption') }}</span>
          <input v-model="draft.backgroundEnabled" type="checkbox" :disabled="!draft.enabled" />
        </label>
        <p class="alert-background-hint">{{ t('monitor.backgroundOptionHint') }}</p>

        <div class="alert-fields">
          <label class="alert-field">
            <span>{{ t('monitor.alertCpuThreshold') }}</span>
            <span class="alert-input-wrap"><input v-model.number="draft.cpuThreshold" type="number" :min="MONITOR_ALERT_MIN_THRESHOLD" :max="MONITOR_ALERT_MAX_THRESHOLD" step="1" /><span>%</span></span>
          </label>
          <label class="alert-field">
            <span>{{ t('monitor.alertMemoryThreshold') }}</span>
            <span class="alert-input-wrap"><input v-model.number="draft.memoryThreshold" type="number" :min="MONITOR_ALERT_MIN_THRESHOLD" :max="MONITOR_ALERT_MAX_THRESHOLD" step="1" /><span>%</span></span>
          </label>
          <label class="alert-field alert-count">
            <span>{{ t('monitor.alertMaxCount') }}</span>
            <span class="alert-input-wrap"><input v-model.number="draft.maxNotificationsPer24h" type="number" :min="MONITOR_ALERT_MIN_NOTIFICATIONS" :max="MONITOR_ALERT_MAX_NOTIFICATIONS" step="1" /><span>{{ t('monitor.alertCountUnit') }}</span></span>
          </label>
        </div>
        <p v-if="invalid" class="alert-error" role="alert">{{ t('monitor.alertInvalid') }}</p>

        <div class="alert-explainer">
          <div class="alert-explainer-title">{{ t('monitor.alertHowItWorks') }}</div>
          <ul>
            <li>{{ t('monitor.alertTriggerHint') }}</li>
            <li>{{ t('monitor.alertRepeatHint') }}</li>
            <li>{{ t('monitor.alertLifetimeHint') }}</li>
          </ul>
        </div>
        <p v-if="isMacOs" class="alert-macos-note">{{ t('monitor.alertMacOsNote') }}</p>

        <div class="alert-actions">
          <button type="button" class="ui-btn ui-btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">{{ saving ? t('common.saving') : t('monitor.alertSave') }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(0 0 0 / 48%);
}
.alert-dialog {
  box-sizing: border-box;
  width: min(460px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
}
.alert-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.alert-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.alert-heading h2 { margin: 0; font-size: 17px; line-height: 1.4; }
.alert-heading > span { overflow: hidden; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; }
.alert-close { position: relative; z-index: 1; display: grid; flex: 0 0 32px; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; }
.alert-close:hover { color: var(--text-primary); }
.alert-close :deep(.app-icon) { pointer-events: none; }
.alert-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  font-weight: 600;
  cursor: pointer;
}
.alert-toggle input { width: 16px; height: 16px; margin: 0; cursor: pointer; }
.alert-background-toggle { margin-top: 10px; font-weight: 500; }
.alert-background-hint { margin: 6px 0 0; color: var(--text-secondary); line-height: 1.5; }
.alert-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
.alert-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.alert-field > span:first-child { font-weight: 500; }
.alert-count { grid-column: 1 / -1; }
.alert-input-wrap { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); }
.alert-input-wrap input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
}
.alert-count .alert-input-wrap input { width: 92px; }
.alert-input-wrap input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.alert-error { margin: 12px 0 0; color: var(--danger); line-height: 1.5; }
.alert-explainer {
  margin-top: 20px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  line-height: 1.5;
}
.alert-explainer-title { margin-bottom: 6px; color: var(--text-primary); font-weight: 600; }
.alert-explainer ul { display: grid; gap: 4px; margin: 0; padding-left: 18px; }
.alert-macos-note {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-left: 3px solid var(--warning);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warning) 8%, var(--bg-primary));
  color: var(--text-primary);
  line-height: 1.5;
}
.alert-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
@media (max-width: 480px) {
  .alert-dialog { padding: 18px; }
  .alert-fields { grid-template-columns: 1fr; }
  .alert-count { grid-column: auto; }
}
</style>
