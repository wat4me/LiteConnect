<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const { t } = useI18n()
const form = reactive({ enabled: false, url: '', mode: 'issues' as 'issues' | 'all', token: '', clearToken: false, hasToken: false })
const working = ref(false)
const loaded = ref(false)
const error = ref('')
const message = ref('')
async function load() {
  try { Object.assign(form, await window.LiteConnect.aiGetNotificationSettings()); loaded.value = true; error.value = '' }
  catch { error.value = t('ai.notification.loadFailed'); loaded.value = true }
}
async function save(test = false) {
  working.value = true; error.value = ''; message.value = ''
  try {
    const result = await window.LiteConnect.aiSaveNotificationSettings({ enabled: form.enabled, url: form.url, mode: form.mode, token: form.clearToken ? '' : form.token || undefined })
    Object.assign(form, result, { token: '', clearToken: false })
    if (test) {
      const delivery = await window.LiteConnect.aiTestNotification()
      if (delivery.status !== 'sent') throw new Error(delivery.error || t('ai.notification.testFailed'))
    }
    message.value = t(test ? 'ai.notification.testSuccess' : 'ai.notification.saved')
  } catch (failure: any) { error.value = failure?.message || t('ai.notification.saveFailed') }
  finally { working.value = false }
}
watch(() => props.open, value => { if (value) void load() })
onMounted(() => { if (props.open !== false) void load() })
</script>
<template>
  <section v-if="open !== false" class="ai-notification-settings" :class="{ panel: open === true }">
    <header v-if="open === true" class="notification-panel-header">
      <strong>{{ t('ai.notification.title') }}</strong>
      <button type="button" class="ui-icon-btn ui-icon-btn-sm" :title="t('common.close')" @click="emit('close')"><AppIcon name="close" size="sm" /></button>
    </header>
    <form v-if="loaded" @submit.prevent="save()">
      <p>{{ t('ai.notification.hint') }}</p>
      <label class="notification-check"><input v-model="form.enabled" type="checkbox" :disabled="working" />{{ t('ai.notification.enable') }}</label>
      <label class="ui-form-field">{{ t('ai.notification.endpoint') }}<input v-model="form.url" class="ui-input notification-url" type="url" :required="form.enabled" autocomplete="off" :disabled="working" placeholder="https://example.com/webhook" /></label>
      <label class="ui-form-field">{{ t('ai.notification.mode') }}<select v-model="form.mode" class="ui-select" :disabled="working"><option value="issues">{{ t('ai.notification.issues') }}</option><option value="all">{{ t('ai.notification.all') }}</option></select></label>
      <label class="ui-form-field">{{ t('ai.notification.token') }}<input v-model="form.token" class="ui-input" type="password" autocomplete="new-password" :disabled="working" :placeholder="t(form.hasToken ? 'ai.notification.tokenStored' : 'ai.notification.tokenOptional')" /></label>
      <label v-if="form.hasToken" class="notification-check"><input v-model="form.clearToken" type="checkbox" :disabled="working" />{{ t('ai.notification.clearToken') }}</label>
      <p>{{ t('ai.notification.tokenHint') }}</p>
      <p v-if="error" role="alert" class="notification-error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
      <div class="notification-actions"><button type="button" class="ui-btn ui-btn-sm notification-test" :disabled="working || !form.url" @click="save(true)">{{ t('ai.notification.test') }}</button><button type="submit" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="working">{{ t('common.save') }}</button></div>
    </form>
    <p v-else>{{ t('common.loading') }}</p>
  </section>
</template>
<style scoped>
.ai-notification-settings { min-width: 0; font-size: var(--font-ui); }
.ai-notification-settings.panel { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4); background: var(--bg-secondary); }
.notification-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
form { display: flex; flex-direction: column; gap: var(--space-4); }
.notification-check { display: flex; align-items: flex-start; gap: var(--space-2); line-height: var(--line-ui); }
.notification-check input { flex-shrink: 0; margin-top: 3px; }
p { margin: 0; font-size: var(--font-ui-sm); line-height: var(--line-reading); color: var(--text-secondary); overflow-wrap: anywhere; }
.notification-error { color: var(--danger); }
.notification-actions { display: flex; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
</style>
