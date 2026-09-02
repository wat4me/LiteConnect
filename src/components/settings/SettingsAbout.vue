<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { UpdateStatus } from '../../env.d'

const { t } = useI18n()

const info = ref<{ version: string; electron: string; platform: string } | null>(null)
const autoUpdateEnabled = ref(false)
const autoUpdateBusy = ref(false)
const checking = ref(false)
const updateStatus = ref<UpdateStatus | null>(null)
let stopUpdateStatus: (() => void) | null = null

const statusText = computed(() => {
  const st = updateStatus.value
  if (!st) return ''
  if (st.status === 'checking') return t('about.checking')
  if (st.status === 'available') return t('about.available', { version: st.version || '' })
  if (st.status === 'not-available') return t('about.notAvailable')
  if (st.status === 'downloading') {
    const pct = Math.max(0, Math.min(100, Math.round(st.progress ?? 0)))
    return t('about.downloading', { progress: pct })
  }
  if (st.status === 'downloaded') return t('about.downloaded')
  if (st.status === 'error') return t('about.error', { message: st.message || t('about.checkFailed') })
  return ''
})

async function toggleAutoUpdate() {
  if (autoUpdateBusy.value) return
  autoUpdateBusy.value = true
  const next = !autoUpdateEnabled.value
  try {
    await window.LiteConnect.setAutoUpdateEnabled(next)
    autoUpdateEnabled.value = next
  } catch (err: any) {
    ElMessage.error(typeof err?.message === 'string' ? err.message : t('about.checkFailed'))
  } finally {
    autoUpdateBusy.value = false
  }
}

async function checkNow() {
  if (checking.value) return
  checking.value = true
  updateStatus.value = { status: 'checking' }
  try {
    const result = await window.LiteConnect.checkForUpdates()
    if (!result.ok) {
      updateStatus.value = { status: 'error', message: result.error || t('about.checkFailed') }
    } else if (updateStatus.value?.status === 'checking') {
      updateStatus.value = { status: 'not-available', version: result.info?.version }
    }
  } catch (err: any) {
    updateStatus.value = {
      status: 'error',
      message: typeof err?.message === 'string' ? err.message : t('about.checkFailed'),
    }
  } finally {
    checking.value = false
  }
}

function installNow() {
  void window.LiteConnect.quitAndInstall()
}

onMounted(async () => {
  try {
    info.value = await window.LiteConnect.getAppInfo()
  } catch {
    info.value = null
  }
  try {
    autoUpdateEnabled.value = await window.LiteConnect.getAutoUpdateEnabled()
  } catch {
    autoUpdateEnabled.value = false
  }
  stopUpdateStatus = window.LiteConnect.onUpdateStatus((status) => {
    updateStatus.value = status
  })
})

onBeforeUnmount(() => {
  stopUpdateStatus?.()
})
</script>

<template>
  <section class="settings-content" data-setting="about">
    <header class="content-header">
      <h3>{{ t('about.title') }}</h3>
      <p>{{ t('about.intro') }}</p>
    </header>

    <div class="settings-card narrow about-card">
      <div class="about-brand">
        <span class="about-name">LiteConnect</span>
        <span v-if="info?.version" class="about-version">v{{ info.version }}</span>
      </div>
      <p class="about-desc">{{ t('about.desc') }}</p>

      <dl class="about-meta">
        <div class="about-meta-row">
          <dt>{{ t('about.version') }}</dt>
          <dd>{{ info?.version || '—' }}</dd>
        </div>
        <div class="about-meta-row">
          <dt>{{ t('about.electron') }}</dt>
          <dd>{{ info?.electron || '—' }}</dd>
        </div>
        <div class="about-meta-row">
          <dt>{{ t('about.platform') }}</dt>
          <dd>{{ info?.platform || '—' }}</dd>
        </div>
        <div class="about-meta-row">
          <dt>{{ t('about.license') }}</dt>
          <dd>{{ t('about.licenseValue') }}</dd>
        </div>
      </dl>
    </div>

    <div class="settings-card narrow about-card">
      <div class="settings-label" data-setting="about.updates">{{ t('about.updates') }}</div>
      <div class="toggle-row">
        <span>{{ t('about.autoUpdate') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: autoUpdateEnabled }"
          :disabled="autoUpdateBusy"
          :aria-pressed="autoUpdateEnabled"
          :aria-label="t('about.autoUpdate')"
          @click="toggleAutoUpdate"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <p class="settings-hint">{{ t('about.autoUpdateHint') }}</p>
      <div class="update-actions">
        <button type="button" class="ui-btn ui-btn-sm" :disabled="checking" @click="checkNow">
          {{ checking ? t('about.checking') : t('about.checkNow') }}
        </button>
        <button
          v-if="updateStatus?.status === 'downloaded'"
          type="button"
          class="ui-btn ui-btn-sm ui-btn-primary"
          @click="installNow"
        >
          {{ t('about.installNow') }}
        </button>
      </div>
      <p v-if="statusText" class="update-status" :class="{ error: updateStatus?.status === 'error' }">
        {{ statusText }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.about-brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.about-name {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.about-version {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}

.about-desc {
  margin: 8px 0 16px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.about-meta {
  margin: 0;
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.about-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.about-meta-row dt {
  font-size: 12px;
  color: var(--text-secondary);
}

.about-meta-row dd {
  margin: 0;
  font-size: 12px;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.update-status {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.update-status.error {
  color: var(--danger);
}
</style>
