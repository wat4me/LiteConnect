<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { SettingsDraft } from '../../composables/useSettingsDraft'

const props = defineProps<{
  draft: SettingsDraft
}>()

const { t } = useI18n()

const x11ResolvedPath = ref<string | null>(null)
const x11Supported = ref(true)
const bundledInstallerAvailable = ref(false)
const x11Testing = ref(false)
const x11KillingResidual = ref(false)
const x11TestResult = ref<{
  ok: boolean
  summary: string
  detail?: string
  port?: number
  residualPid?: number
  canKillResidual?: boolean
} | null>(null)
let x11StatusRequest = 0

async function refreshX11Status() {
  const request = ++x11StatusRequest
  try {
    // Pass the unsaved draft so typing or clearing a path immediately updates
    // the detection hint without changing the live X11 launch configuration.
    const st = await window.LiteConnect.getX11ServerStatus(props.draft.x11ServerPath)
    if (request === x11StatusRequest) {
      x11ResolvedPath.value = st.resolvedExecutablePath
      x11Supported.value = st.supported
    }
  } catch {
    if (request === x11StatusRequest) x11ResolvedPath.value = null
  }
}

async function pickX11Executable() {
  const path = await window.LiteConnect.selectX11ServerExecutable()
  if (path) {
    props.draft.x11ServerPath = path
    await refreshX11Status()
  }
}

async function refreshBundledInstallerStatus() {
  try {
    bundledInstallerAvailable.value = (await window.LiteConnect.getBundledX11InstallerStatus()).available
  } catch {
    bundledInstallerAvailable.value = false
  }
}

async function installBundledX11Server() {
  try {
    const result = await window.LiteConnect.installBundledX11Server()
    if (result.started) {
      ElMessage.success(t('settingsNetwork.installerStarted'))
    } else if (result.cancelled) {
      ElMessage.info(t('settingsNetwork.installerCancelled'))
    }
  } catch (err: any) {
    // Main process already localizes; fall back if message is missing.
    const message =
      typeof err?.message === 'string' && err.message.trim() && err.message !== 'Error'
        ? err.message
        : t('settingsNetwork.installerOpenFailed')
    ElMessage.error(message)
  }
}

async function testX11Server() {
  if (x11Testing.value) return
  x11Testing.value = true
  x11TestResult.value = null
  try {
    const result = await window.LiteConnect.testX11Server({
      executablePath: props.draft.x11ServerPath,
      host: '127.0.0.1',
      display: 0,
    })
    await refreshX11Status()
    if (result.ready) {
      const summary = result.started
        ? t('settingsNetwork.testX11OkStarted', { host: result.host, port: result.port })
        : t('settingsNetwork.testX11OkAlready', { host: result.host, port: result.port })
      const detail = result.executablePath
        ? t('settingsNetwork.testX11OkExe', { path: result.executablePath })
        : x11ResolvedPath.value
          ? t('settingsNetwork.testX11OkExe', { path: x11ResolvedPath.value })
          : undefined
      x11TestResult.value = { ok: true, summary, detail, port: result.port }
      ElMessage.success(summary)
    } else {
      const detail = result.message || t('x11.notReady')
      const summary = t('settingsNetwork.testX11Failed', { detail })
      const residual =
        result.portOccupiedNotX11
        && result.portOwner?.kind === 'xserver_residual'
        && result.portOwner.pid > 0
      x11TestResult.value = {
        ok: false,
        summary,
        detail,
        port: result.port,
        residualPid: residual ? result.portOwner!.pid : undefined,
        canKillResidual: !!residual,
      }
      // Port-occupied is a clear actionable state — warning is enough (not a crash).
      if (result.portOccupiedNotX11) ElMessage.warning(summary)
      else ElMessage.error(summary)
    }
  } catch (err: any) {
    const detail =
      typeof err?.message === 'string' && err.message.trim()
        ? err.message
        : t('x11.notReady')
    const summary = t('settingsNetwork.testX11Failed', { detail })
    x11TestResult.value = { ok: false, summary, detail }
    ElMessage.error(summary)
  } finally {
    x11Testing.value = false
  }
}

async function killResidualX11() {
  const cur = x11TestResult.value
  if (!cur?.canKillResidual || !cur.residualPid || x11KillingResidual.value) return
  x11KillingResidual.value = true
  try {
    const res = await window.LiteConnect.killResidualX11Process({
      pid: cur.residualPid,
      port: cur.port ?? 6000,
    })
    ElMessage.success(t('x11.residualKillOk', { process: res.process }))
    x11TestResult.value = {
      ok: false,
      summary: t('x11.residualKillOk', { process: res.process }),
      detail: t('settingsNetwork.killResidualXHint'),
      canKillResidual: false,
    }
    // Re-test after kill so user immediately sees free port / successful start
    await testX11Server()
  } catch (err: any) {
    const message =
      typeof err?.message === 'string' && err.message.trim()
        ? err.message
        : t('x11.residualKillFailed', { error: 'unknown' })
    ElMessage.error(message)
  } finally {
    x11KillingResidual.value = false
  }
}

function clearX11Path() {
  props.draft.x11ServerPath = ''
}

onMounted(() => {
  void refreshX11Status()
  void refreshBundledInstallerStatus()
  window.addEventListener('focus', refreshX11Status)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshX11Status)
})

watch(
  () => props.draft.x11ServerPath,
  () => { void refreshX11Status() },
)
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsNetwork.title') }}</h3>
      <p>{{ t('settingsNetwork.intro') }}</p>
    </header>
    <div class="settings-card narrow">
      <div class="settings-label">{{ t('settingsNetwork.latency') }}</div>
      <div class="toggle-row">
        <span>{{ draft.latencyEnabled ? t('settingsNetwork.enabled') : t('settingsNetwork.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.latencyEnabled }"
          @click="draft.latencyEnabled = !draft.latencyEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div v-if="draft.latencyEnabled" class="interval-row">
        <span>{{ t('settingsNetwork.interval') }}</span>
        <button type="button" class="font-size-btn" @click="draft.latencyIntervalSec = Math.max(1, draft.latencyIntervalSec - 1)">−</button>
        <span class="font-size-value">{{ draft.latencyIntervalSec }}s</span>
        <button type="button" class="font-size-btn" @click="draft.latencyIntervalSec = Math.min(60, draft.latencyIntervalSec + 1)">+</button>
      </div>

      <div class="settings-label" style="margin-top: 18px">{{ t('settingsNetwork.monitor') }}</div>
      <div class="toggle-row">
        <span>{{ draft.monitorEnabled ? t('settingsNetwork.enabled') : t('settingsNetwork.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.monitorEnabled }"
          @click="draft.monitorEnabled = !draft.monitorEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div v-if="draft.monitorEnabled" class="interval-row">
        <span>{{ t('settingsNetwork.interval') }}</span>
        <button type="button" class="font-size-btn" @click="draft.monitorIntervalSec = Math.max(2, draft.monitorIntervalSec - 1)">−</button>
        <span class="font-size-value">{{ draft.monitorIntervalSec }}s</span>
        <button type="button" class="font-size-btn" @click="draft.monitorIntervalSec = Math.min(30, draft.monitorIntervalSec + 1)">+</button>
      </div>

      <div class="settings-label" style="margin-top: 18px">{{ t('settingsNetwork.autoReconnect') }}</div>
      <div class="toggle-row">
        <span>{{ draft.autoReconnectEnabled ? t('settingsNetwork.enabled') : t('settingsNetwork.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.autoReconnectEnabled }"
          @click="draft.autoReconnectEnabled = !draft.autoReconnectEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div v-if="draft.autoReconnectEnabled" class="interval-row">
        <span>{{ t('settingsNetwork.maxRetries') }}</span>
        <button type="button" class="font-size-btn" @click="draft.autoReconnectMaxRetries = Math.max(0, draft.autoReconnectMaxRetries - 1)">−</button>
        <span class="font-size-value">{{ draft.autoReconnectMaxRetries }}</span>
        <button type="button" class="font-size-btn" @click="draft.autoReconnectMaxRetries = Math.min(20, draft.autoReconnectMaxRetries + 1)">+</button>
      </div>
      <div class="settings-hint">
        {{ t('settingsNetwork.autoReconnectHint') }}
      </div>

      <div class="settings-label" style="margin-top: 18px">{{ t('settingsNetwork.graphical') }}</div>
      <div class="toggle-row">
        <span>{{ draft.x11AutoStartEnabled ? t('settingsNetwork.autoStartOn') : t('settingsNetwork.autoStartOff') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.x11AutoStartEnabled }"
          @click="draft.x11AutoStartEnabled = !draft.x11AutoStartEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="settings-hint">
        {{ t('settingsNetwork.autoStartHint') }}
      </div>
      <div v-if="!x11Supported" class="settings-hint warn">
        {{ t('settingsNetwork.autoStartUnsupported') }}
      </div>
      <div class="settings-label" style="margin-top: 12px">{{ t('settingsNetwork.serverPath') }}</div>
      <div class="path-row">
        <input
          v-model="draft.x11ServerPath"
          class="settings-input"
          type="text"
          :placeholder="t('settingsNetwork.serverPathPlaceholder')"
        />
        <button type="button" class="ui-btn" @click="pickX11Executable">{{ t('common.browse') }}</button>
        <button type="button" class="ui-btn" :disabled="!draft.x11ServerPath" @click="clearX11Path">{{ t('common.clear') }}</button>
      </div>
      <div v-if="x11ResolvedPath" class="settings-hint">
        {{ t('settingsNetwork.willUse', { path: x11ResolvedPath }) }}
      </div>
      <div v-else class="settings-hint warn">
        {{ t('settingsNetwork.notFound') }}
      </div>
      <div v-if="!x11ResolvedPath" class="x11-install-help">
        <span>{{ t('settingsNetwork.installHint') }}</span>
        <button
          type="button"
          class="ui-btn ui-btn-sm"
          :disabled="!bundledInstallerAvailable"
          @click="installBundledX11Server"
        >
          {{ t('settingsNetwork.installVcXsrv') }}
        </button>
      </div>

      <div class="settings-label" style="margin-top: 14px">{{ t('settingsNetwork.testX11') }}</div>
      <div class="x11-test-row">
        <button
          type="button"
          class="ui-btn ui-btn-primary"
          :disabled="!x11Supported || x11Testing"
          @click="testX11Server"
        >
          {{ x11Testing ? t('settingsNetwork.testX11Running') : t('settingsNetwork.testX11') }}
        </button>
      </div>
      <div class="settings-hint">
        {{ x11Supported ? t('settingsNetwork.testX11Hint') : t('settingsNetwork.testX11Unsupported') }}
      </div>
      <div
        v-if="x11TestResult"
        class="x11-test-result"
        :class="x11TestResult.ok ? 'ok' : 'fail'"
        role="status"
      >
        <div class="x11-test-summary">{{ x11TestResult.summary }}</div>
        <div v-if="x11TestResult.detail" class="x11-test-detail">{{ x11TestResult.detail }}</div>
        <div v-if="x11TestResult.canKillResidual" class="x11-residual-actions">
          <span class="x11-test-detail">{{ t('settingsNetwork.killResidualXHint') }}</span>
          <button
            type="button"
            class="ui-btn ui-btn-sm"
            :disabled="x11KillingResidual || x11Testing"
            @click="killResidualX11"
          >
            {{ x11KillingResidual ? t('settingsNetwork.killResidualXRunning') : t('settingsNetwork.killResidualX') }}
          </button>
        </div>
      </div>
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
}

.settings-card.narrow {
  max-width: 520px;
}

.settings-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.x11-install-help {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.x11-test-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ui-btn-primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-primary));
  color: var(--accent);
  font-weight: 600;
}

.ui-btn-primary:not(:disabled):hover {
  background: color-mix(in srgb, var(--accent) 28%, var(--bg-primary));
}

.x11-test-result {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  font-size: 12px;
  line-height: 1.5;
}

.x11-test-result.ok {
  border-color: color-mix(in srgb, var(--success, #3fb950) 45%, var(--border-color));
  background: color-mix(in srgb, var(--success, #3fb950) 10%, transparent);
  color: var(--text-primary);
}

.x11-test-result.fail {
  border-color: color-mix(in srgb, var(--warning, #d29922) 50%, var(--border-color));
  background: color-mix(in srgb, var(--warning, #d29922) 12%, transparent);
  color: var(--text-primary);
}

.x11-test-summary {
  font-weight: 600;
}

.x11-test-detail {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
}

.x11-residual-actions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.ui-btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 11px;
}

.font-size-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.font-size-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.font-size-value {
  min-width: 48px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
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
  transition: transform 0.15s ease;
}

.toggle-btn.active .toggle-knob {
  transform: translateX(18px);
}

.interval-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 4px;
}
</style>
