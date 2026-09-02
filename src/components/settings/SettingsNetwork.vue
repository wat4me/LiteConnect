<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'

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

type HostKeyRow = { host: string; port: number; fingerprint: string; firstSeen: number }

const knownHosts = ref<HostKeyRow[]>([])
const knownHostsLoading = ref(false)

async function refreshKnownHosts() {
  knownHostsLoading.value = true
  try {
    knownHosts.value = await window.LiteConnect.sshListHostKeys()
  } catch {
    knownHosts.value = []
  } finally {
    knownHostsLoading.value = false
  }
}

async function removeKnownHost(entry: HostKeyRow) {
  try {
    await appConfirm({
      title: t('settingsNetwork.knownHostsRemoveTitle'),
      message: t('settingsNetwork.knownHostsRemoveMessage', { host: entry.host, port: entry.port }),
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
    ElMessage.success(t('settingsNetwork.knownHostsRemoved'))
    await refreshKnownHosts()
  } catch (err: any) {
    ElMessage.error(err?.message || t('settingsNetwork.knownHostsRemoveFailed'))
  }
}

function formatFirstSeen(ts: number): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return String(ts)
  }
}

onMounted(() => {
  void refreshX11Status()
  void refreshBundledInstallerStatus()
  void refreshKnownHosts()
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
  <section class="settings-content" data-setting="network">
    <header class="content-header">
      <h3>{{ t('settingsNetwork.title') }}</h3>
      <p>{{ t('settingsNetwork.intro') }}</p>
    </header>
    <div class="settings-card narrow">
      <div class="settings-label" data-setting="network.latency">{{ t('settingsNetwork.latency') }}</div>
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

      <div class="settings-label" style="margin-top: 18px" data-setting="network.usageStats">{{ t('settingsNetwork.usageStats') }}</div>
      <div class="toggle-row">
        <span>{{ draft.connectionUsageStatsEnabled ? t('settingsNetwork.enabled') : t('settingsNetwork.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.connectionUsageStatsEnabled }"
          @click="draft.connectionUsageStatsEnabled = !draft.connectionUsageStatsEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <p class="settings-hint">{{ t('settingsNetwork.usageStatsHint') }}</p>

      <div class="settings-label" style="margin-top: 18px" data-setting="network.monitor">{{ t('settingsNetwork.monitor') }}</div>
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

      <div class="settings-label" style="margin-top: 18px" data-setting="network.autoReconnect">{{ t('settingsNetwork.autoReconnect') }}</div>
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

      <div class="settings-label" style="margin-top: 18px" data-setting="network.workspaceRestore">{{ t('settingsNetwork.workspaceRestore') }}</div>
      <div class="toggle-row">
        <span>{{ draft.workspaceRestoreEnabled ? t('settingsNetwork.enabled') : t('settingsNetwork.disabled') }}</span>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.workspaceRestoreEnabled }"
          @click="draft.workspaceRestoreEnabled = !draft.workspaceRestoreEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
      <div class="settings-hint">
        {{ t('settingsNetwork.workspaceRestoreHint') }}
      </div>

      <div class="settings-label" style="margin-top: 18px" data-setting="network.x11">{{ t('settingsNetwork.graphical') }}</div>
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

    <div class="settings-card narrow known-hosts-card">
      <div class="settings-label" data-setting="network.knownHosts">{{ t('settingsNetwork.knownHostsTitle') }}</div>
      <p class="settings-hint">{{ t('settingsNetwork.knownHostsHint') }}</p>
      <div v-if="knownHostsLoading" class="settings-hint">{{ t('common.loading') }}</div>
      <div v-else-if="knownHosts.length === 0" class="settings-hint">{{ t('settingsNetwork.knownHostsEmpty') }}</div>
      <ul v-else class="known-hosts-list">
        <li v-for="entry in knownHosts" :key="`${entry.host}:${entry.port}`" class="known-host-item">
          <div class="known-host-info">
            <span class="known-host-addr">{{ entry.host }}:{{ entry.port }}</span>
            <span class="known-host-fp">{{ entry.fingerprint }}</span>
            <span class="known-host-date">{{ t('settingsNetwork.knownHostsFirstSeen', { time: formatFirstSeen(entry.firstSeen) }) }}</span>
          </div>
          <button type="button" class="ui-btn ui-btn-sm" @click="removeKnownHost(entry)">
            {{ t('common.delete') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.x11-install-help {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.x11-test-row {
  display: flex;
  align-items: center;
  gap: 8px;
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
  border-color: color-mix(in srgb, var(--success) 45%, var(--border-color));
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--text-primary);
}

.x11-test-result.fail {
  border-color: color-mix(in srgb, var(--warning) 50%, var(--border-color));
  background: color-mix(in srgb, var(--warning) 12%, transparent);
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

.known-hosts-card {
  margin-top: 16px;
}

.known-hosts-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.known-host-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
}

.known-host-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.known-host-addr {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.known-host-fp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
}

.known-host-date {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.85;
}

</style>
