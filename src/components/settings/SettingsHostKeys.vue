<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'

type HostKeyRow = { host: string; port: number; fingerprint: string; firstSeen: number }

const { t } = useI18n()
const hostKeys = ref<HostKeyRow[]>([])
const loading = ref(false)

async function refreshHostKeys() {
  loading.value = true
  try {
    hostKeys.value = await window.LiteConnect.sshListHostKeys()
  } catch (err: any) {
    hostKeys.value = []
    ElMessage.error(err?.message || t('settingsHostKeys.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function removeHostKey(entry: HostKeyRow) {
  try {
    await appConfirm({
      title: t('settingsHostKeys.removeTitle'),
      message: t('settingsHostKeys.removeMessage', { host: entry.host, port: entry.port }),
      detail: entry.fingerprint,
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      tone: 'warning',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await window.LiteConnect.sshRemoveHostKey(entry.host, entry.port)
    ElMessage.success(t('settingsHostKeys.removed'))
    await refreshHostKeys()
  } catch (err: any) {
    ElMessage.error(err?.message || t('settingsHostKeys.removeFailed'))
  }
}

function formatFirstSeen(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return String(timestamp)
  }
}

onMounted(() => {
  void refreshHostKeys()
})
</script>

<template>
  <section class="settings-content" data-setting="hostKeys">
    <header class="content-header">
      <h3>{{ t('settingsHostKeys.title') }}</h3>
      <p>{{ t('settingsHostKeys.intro') }}</p>
    </header>

    <div class="settings-card narrow">
      <div class="settings-card-title" data-setting="hostKeys.trusted">{{ t('settingsHostKeys.trusted') }}</div>
      <p class="settings-hint">{{ t('settingsHostKeys.hint') }}</p>

      <div v-if="loading" class="host-keys-state">{{ t('common.loading') }}</div>
      <div v-else-if="hostKeys.length === 0" class="host-keys-state empty">
        {{ t('settingsHostKeys.empty') }}
      </div>
      <ul v-else class="host-keys-list">
        <li v-for="entry in hostKeys" :key="`${entry.host}:${entry.port}`" class="host-key-item">
          <div class="host-key-info">
            <span class="host-key-address">{{ entry.host }}:{{ entry.port }}</span>
            <code class="host-key-fingerprint">{{ entry.fingerprint }}</code>
            <span class="host-key-date">{{ t('settingsHostKeys.firstSeen', { time: formatFirstSeen(entry.firstSeen) }) }}</span>
          </div>
          <button type="button" class="ui-btn ui-btn-sm" @click="removeHostKey(entry)">
            {{ t('common.delete') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.host-keys-state {
  margin-top: 18px;
  padding: 24px 12px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.host-keys-state.empty {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent);
}

.host-keys-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.host-key-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
}

.host-key-info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.host-key-address {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.host-key-fingerprint {
  color: var(--text-secondary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.host-key-date {
  color: var(--text-secondary);
  font-size: 11px;
  opacity: 0.85;
}

@media (max-width: 640px) {
  .host-key-item {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
