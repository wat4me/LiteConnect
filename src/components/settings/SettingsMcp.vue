<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { McpHttpStatus } from '../../env.d'
import { MCP_HTTP_DEFAULT_PORT } from '@shared/mcp/limits'

const { t } = useI18n()

const mcpStatus = ref<McpHttpStatus | null>(null)
const mcpBusy = ref(false)
const mcpPortDraft = ref(MCP_HTTP_DEFAULT_PORT)

async function refreshMcpStatus() {
  try {
    const st = await window.LiteConnect.mcpGetHttpStatus()
    mcpStatus.value = st
    mcpPortDraft.value = st.port
  } catch {
    mcpStatus.value = null
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('common.copied'))
  } catch {
    ElMessage.error(t('common.copyFailed'))
  }
}

async function toggleMcp() {
  if (!mcpStatus.value || mcpBusy.value) return
  const next = !mcpStatus.value.enabled
  if (next) {
    try {
      await appConfirm({
        title: t('settingsMcp.enableTitle'),
        message: t('settingsMcp.enableMessage'),
        confirmText: t('settingsMcp.enableConfirm'),
        tone: 'warning',
      })
    } catch {
      return
    }
  }
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetHttpEnabled(next)
    mcpPortDraft.value = mcpStatus.value.port
  } catch (err: any) {
    ElMessage.error(
      t('settingsMcp.startFailed', {
        error: typeof err?.message === 'string' ? err.message : String(err),
      }),
    )
    await refreshMcpStatus()
  } finally {
    mcpBusy.value = false
  }
}

async function applyMcpPort() {
  if (mcpBusy.value) return
  const port = Math.max(1024, Math.min(65535, Math.round(Number(mcpPortDraft.value)) || MCP_HTTP_DEFAULT_PORT))
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetHttpPort(port)
    mcpPortDraft.value = mcpStatus.value.port
  } catch (err: any) {
    ElMessage.error(
      t('settingsMcp.startFailed', {
        error: typeof err?.message === 'string' ? err.message : String(err),
      }),
    )
    await refreshMcpStatus()
  } finally {
    mcpBusy.value = false
  }
}

async function rotateMcpToken() {
  if (mcpBusy.value) return
  try {
    await appConfirm({
      title: t('settingsMcp.rotateTitle'),
      message: t('settingsMcp.rotateMessage'),
      confirmText: t('settingsMcp.rotateConfirm'),
      tone: 'warning',
    })
  } catch {
    return
  }
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpRotateHttpToken()
  } finally {
    mcpBusy.value = false
  }
}

const shareCard = computed(() => {
  const st = mcpStatus.value
  if (!st) return ''
  const health = st.url.replace(/\/mcp\/?$/, '/health')
  return t('settingsMcp.shareCard', { url: st.url, token: st.token, health })
})

const authHeader = computed(() => {
  const token = mcpStatus.value?.token
  return token ? `Authorization: Bearer ${token}` : ''
})

onMounted(() => {
  void refreshMcpStatus()
})
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsMcp.title') }}</h3>
      <p>{{ t('settingsMcp.intro') }}</p>
    </header>
    <div class="settings-card">
      <div class="settings-label">{{ t('settingsMcp.service') }}</div>
      <div class="toggle-row">
        <span>{{ mcpStatus?.enabled ? t('settingsMcp.enabled') : t('settingsMcp.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: !!mcpStatus?.enabled }"
          :disabled="mcpBusy || !mcpStatus"
          @click="toggleMcp"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <p class="settings-hint">{{ t('settingsMcp.hint') }}</p>
      <p class="settings-hint" :class="{ warn: !!mcpStatus?.lastError }">
        <template v-if="mcpStatus?.listening">{{ t('settingsMcp.listening', { url: mcpStatus.url }) }}</template>
        <template v-else-if="mcpStatus?.lastError">{{ t('settingsMcp.startFailed', { error: mcpStatus.lastError }) }}</template>
        <template v-else>{{ t('settingsMcp.stopped') }}</template>
      </p>
      <div class="settings-label" style="margin-top: 12px">{{ t('settingsMcp.port') }}</div>
      <div class="path-row">
        <input
          v-model.number="mcpPortDraft"
          class="settings-input mcp-port-input"
          type="number"
          min="1024"
          max="65535"
        />
        <button type="button" class="ui-btn" :disabled="mcpBusy || !mcpStatus" @click="applyMcpPort">
          {{ t('settingsMcp.applyPort') }}
        </button>
      </div>
      <div class="settings-label" style="margin-top: 12px">{{ t('settingsMcp.token') }}</div>
      <div class="path-row">
        <input class="settings-input" type="text" readonly :value="mcpStatus?.token || ''" />
        <button
          type="button"
          class="ui-btn"
          :disabled="!mcpStatus?.token"
          @click="mcpStatus && copyText(mcpStatus.token)"
        >
          {{ t('settingsMcp.copyToken') }}
        </button>
        <button type="button" class="ui-btn" :disabled="mcpBusy || !mcpStatus" @click="rotateMcpToken">
          {{ t('settingsMcp.rotate') }}
        </button>
      </div>
      <div class="settings-label" style="margin-top: 16px">{{ t('settingsMcp.anyClient') }}</div>
      <p class="settings-hint">{{ t('settingsMcp.anyClientHint') }}</p>
      <dl class="mcp-facts">
        <div>
          <dt>{{ t('settingsMcp.endpoint') }}</dt>
          <dd>{{ mcpStatus?.url || '—' }}</dd>
        </div>
        <div>
          <dt>{{ t('settingsMcp.transport') }}</dt>
          <dd>{{ t('settingsMcp.transportValue') }}</dd>
        </div>
        <div>
          <dt>{{ t('settingsMcp.authHeader') }}</dt>
          <dd>{{ authHeader || '—' }}</dd>
        </div>
      </dl>
      <div class="path-row">
        <button type="button" class="ui-btn ui-btn-sm" :disabled="!mcpStatus?.url" @click="mcpStatus && copyText(mcpStatus.url)">
          {{ t('settingsMcp.copyUrl') }}
        </button>
        <button type="button" class="ui-btn ui-btn-sm" :disabled="!shareCard" @click="copyText(shareCard)">
          {{ t('settingsMcp.copyShare') }}
        </button>
      </div>
      <div class="settings-label" style="margin-top: 14px">{{ t('settingsMcp.genericHint') }}</div>
      <pre class="mcp-snippet">{{ mcpStatus?.snippets.generic || '' }}</pre>
      <button
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="!mcpStatus"
        @click="mcpStatus && copyText(mcpStatus.snippets.generic)"
      >
        {{ t('settingsMcp.copyGeneric') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.content-header {
  margin-bottom: 20px;
  max-width: 720px;
}

.content-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text-primary);
}

.content-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.settings-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 16px;
  max-width: 720px;
}

.settings-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.settings-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.settings-hint.warn {
  color: var(--warning, #d29922);
}

.path-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.settings-input {
  flex: 1;
  min-width: 180px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}

.mcp-port-input {
  flex: 0 0 120px;
  min-width: 120px;
}

.ui-btn {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.ui-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ui-btn:not(:disabled):hover {
  border-color: var(--accent);
  color: var(--accent);
}

.ui-btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-primary);
}

.toggle-btn {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  position: relative;
  cursor: pointer;
  padding: 0;
}

.toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle-btn.active {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s ease;
}

.toggle-btn.active .toggle-knob {
  left: 20px;
}

.mcp-facts {
  margin: 10px 0 8px;
  display: grid;
  gap: 8px;
}

.mcp-facts > div {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px;
  align-items: start;
  font-size: 12px;
}

.mcp-facts dt {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.mcp-facts dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.mcp-snippet {
  margin: 0 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
