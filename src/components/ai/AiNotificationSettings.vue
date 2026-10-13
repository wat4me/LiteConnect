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
      <label><input v-model="form.enabled" type="checkbox" :disabled="working" />{{ t('ai.notification.enable') }}</label>
      <label>{{ t('ai.notification.endpoint') }}<input v-model="form.url" class="notification-url" type="url" :required="form.enabled" autocomplete="off" :disabled="working" placeholder="https://example.com/webhook" /></label>
      <label>{{ t('ai.notification.mode') }}<select v-model="form.mode" :disabled="working"><option value="issues">{{ t('ai.notification.issues') }}</option><option value="all">{{ t('ai.notification.all') }}</option></select></label>
      <label>{{ t('ai.notification.token') }}<input v-model="form.token" type="password" autocomplete="new-password" :disabled="working" :placeholder="t(form.hasToken ? 'ai.notification.tokenStored' : 'ai.notification.tokenOptional')" /></label>
      <label v-if="form.hasToken"><input v-model="form.clearToken" type="checkbox" :disabled="working" />{{ t('ai.notification.clearToken') }}</label>
      <p>{{ t('ai.notification.tokenHint') }}</p>
      <p v-if="error" role="alert" class="notification-error">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
      <div class="notification-actions"><button type="submit" class="ui-btn ui-btn-sm" :disabled="working">{{ t('common.save') }}</button><button type="button" class="ui-btn ui-btn-sm notification-test" :disabled="working || !form.url" @click="save(true)">{{ t('ai.notification.test') }}</button></div>
    </form>
    <p v-else>{{ t('common.loading') }}</p>
  </section>
</template>
<style scoped>
.ai-notification-settings { font-size: 12px; }
.ai-notification-settings.panel { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 14px; background: var(--bg-secondary); }
.notification-panel-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
form { display: flex; flex-direction: column; gap: 10px; }
label { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
input:not([type=checkbox]), select { flex: 1; min-width: 100px; padding: 7px; border-radius: 5px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); }
p { margin: 0; line-height: 1.6; color: var(--text-secondary); }
.notification-error { color: var(--danger); }
.notification-actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
