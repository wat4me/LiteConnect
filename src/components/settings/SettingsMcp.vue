<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { McpHttpStatus } from '../../env.d'
import type { ApprovalMode } from '@shared/mcp/types'
import { MCP_HTTP_DEFAULT_PORT } from '@shared/mcp/limits'
import {
  MCP_DESTRUCTIVE_BINARY_NAMES,
  MCP_INTERPRETER_NAMES,
  MCP_PRIVILEGE_WRAPPER_NAMES,
} from '@shared/mcp/classify'

const { t } = useI18n()

const mcpStatus = ref<McpHttpStatus | null>(null)
const mcpBusy = ref(false)
const mcpPortDraft = ref(MCP_HTTP_DEFAULT_PORT)

const approvalModes: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  { id: 'deny-destructive', label: 'settingsMcp.approvalDeny', hint: 'settingsMcp.approvalDenyHint' },
  { id: 'ask-destructive', label: 'settingsMcp.approvalAsk', hint: 'settingsMcp.approvalAskHint' },
  { id: 'auto', label: 'settingsMcp.approvalAuto', hint: 'settingsMcp.approvalAutoHint' },
]

const dynamicPolicyExamples = [
  { command: 'kill -0 <PID>', result: 'settingsMcp.policyRuleKillProbe' },
  { command: 'systemctl status / start / stop', result: 'settingsMcp.policyRuleSystemctl' },
  { command: 'git clean / reset --hard / push --force', result: 'settingsMcp.policyRuleGit' },
  { command: 'sed -i / find -delete / rsync --delete', result: 'settingsMcp.policyRuleMutationFlags' },
  { command: 'curl / wget', result: 'settingsMcp.policyRuleNetwork' },
  { command: 'docker / podman / kubectl / helm / terraform', result: 'settingsMcp.policyRuleCli' },
  { command: 'sh -c / bash -c / python -c / node -e', result: 'settingsMcp.policyRuleScripts' },
] as const

const highRiskExamples = [
  'rm -rf /',
  'dd … of=/dev/…',
  'curl … | sh',
  'chmod -R … /',
  '> /etc/passwd',
  '… > ~/.ssh/authorized_keys',
]

const activePolicySummary = computed(() => {
  const mode = mcpStatus.value?.approvalMode || 'deny-destructive'
  if (mode === 'auto') {
    return { tone: 'danger', title: t('settingsMcp.policyCurrentAuto'), detail: t('settingsMcp.policyCurrentAutoHint') }
  }
  if (mode === 'ask-destructive') {
    return { tone: 'ask', title: t('settingsMcp.policyCurrentAsk'), detail: t('settingsMcp.policyCurrentAskHint') }
  }
  return { tone: 'deny', title: t('settingsMcp.policyCurrentDeny'), detail: t('settingsMcp.policyCurrentDenyHint') }
})

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

async function setApprovalMode(mode: ApprovalMode) {
  if (!mcpStatus.value || mcpBusy.value || mcpStatus.value.approvalMode === mode) return
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetApprovalMode(mode)
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

const agentPrompt = computed(() => {
  const st = mcpStatus.value
  if (!st?.url || !st.token) return ''
  return t('settingsMcp.agentPrompt', { url: st.url, token: st.token })
})

onMounted(() => {
  void refreshMcpStatus()
})
</script>

<template>
  <section class="settings-content" data-setting="mcp">
    <header class="content-header">
      <h3>{{ t('settingsMcp.title') }}</h3>
      <p>{{ t('settingsMcp.intro') }}</p>
    </header>
    <div class="settings-card">
      <div class="settings-label" data-setting="mcp.service">{{ t('settingsMcp.service') }}</div>
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
      <div class="settings-label" style="margin-top: 16px" data-setting="mcp.approval">{{ t('settingsMcp.approval') }}</div>
      <p class="settings-hint">{{ t('settingsMcp.approvalHint') }}</p>
      <div class="mcp-approval-list">
        <button
          v-for="item in approvalModes"
          :key="item.id"
          type="button"
          class="mcp-approval-option"
          :class="{ active: (mcpStatus?.approvalMode || 'deny-destructive') === item.id }"
          :disabled="mcpBusy || !mcpStatus"
          @click="setApprovalMode(item.id)"
        >
          <span class="mcp-approval-title">{{ t(item.label) }}</span>
          <span class="mcp-approval-desc">{{ t(item.hint) }}</span>
        </button>
      </div>
      <details class="command-policy-details">
        <summary>
          <span>{{ t('settingsMcp.policyDetails') }}</span>
          <span class="policy-count">{{ MCP_DESTRUCTIVE_BINARY_NAMES.length }}</span>
        </summary>
        <div class="command-policy-body">
          <div class="active-policy" :data-tone="activePolicySummary.tone">
            <strong>{{ activePolicySummary.title }}</strong>
            <span>{{ activePolicySummary.detail }}</span>
          </div>
          <p class="settings-hint policy-intro">{{ t('settingsMcp.policyDetailsHint') }}</p>

          <div class="policy-section">
            <div class="policy-section-title">
              <span>{{ t('settingsMcp.policyDestructive') }}</span>
              <span>{{ t('settingsMcp.policyItems', { count: MCP_DESTRUCTIVE_BINARY_NAMES.length }) }}</span>
            </div>
            <p class="settings-hint">{{ t('settingsMcp.policyDestructiveHint') }}</p>
            <div class="command-chip-list">
              <code v-for="name in MCP_DESTRUCTIVE_BINARY_NAMES" :key="name">{{ name }}</code>
            </div>
          </div>

          <div class="policy-section">
            <div class="policy-section-title">
              <span>{{ t('settingsMcp.policyPrivileged') }}</span>
              <span>{{ t('settingsMcp.policyItems', { count: MCP_PRIVILEGE_WRAPPER_NAMES.length }) }}</span>
            </div>
            <p class="settings-hint">{{ t('settingsMcp.policyPrivilegedHint') }}</p>
            <div class="command-chip-list">
              <code v-for="name in MCP_PRIVILEGE_WRAPPER_NAMES" :key="name">{{ name }}</code>
            </div>
          </div>

          <div class="policy-section">
            <div class="policy-section-title">
              <span>{{ t('settingsMcp.policyHighRisk') }}</span>
            </div>
            <p class="settings-hint">{{ t('settingsMcp.policyHighRiskHint') }}</p>
            <div class="command-chip-list danger">
              <code v-for="command in highRiskExamples" :key="command">{{ command }}</code>
            </div>
          </div>

          <div class="policy-section">
            <div class="policy-section-title">
              <span>{{ t('settingsMcp.policyDynamic') }}</span>
            </div>
            <p class="settings-hint">{{ t('settingsMcp.policyDynamicHint') }}</p>
            <div class="policy-rule-list">
              <div v-for="rule in dynamicPolicyExamples" :key="rule.command" class="policy-rule">
                <code>{{ rule.command }}</code>
                <span>{{ t(rule.result) }}</span>
              </div>
              <div class="policy-rule">
                <code>{{ MCP_INTERPRETER_NAMES.join(' / ') }}</code>
                <span>{{ t('settingsMcp.policyRuleInterpreters') }}</span>
              </div>
              <div class="policy-rule">
                <code>{{ t('settingsMcp.policyUnknownCommand') }}</code>
                <span>{{ t('settingsMcp.policyRuleUnknown') }}</span>
              </div>
            </div>
          </div>
        </div>
      </details>
      <p class="settings-hint" :class="{ warn: !!mcpStatus?.lastError }">
        <template v-if="mcpStatus?.listening">{{ t('settingsMcp.listening', { url: mcpStatus.url }) }}</template>
        <template v-else-if="mcpStatus?.lastError">{{ t('settingsMcp.startFailed', { error: mcpStatus.lastError }) }}</template>
        <template v-else>{{ t('settingsMcp.stopped') }}</template>
      </p>
      <div class="settings-label" style="margin-top: 12px" data-setting="mcp.port">{{ t('settingsMcp.port') }}</div>
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
      <div class="settings-label" style="margin-top: 12px" data-setting="mcp.token">{{ t('settingsMcp.token') }}</div>
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
      <div class="settings-label" style="margin-top: 16px">{{ t('settingsMcp.copyAgentPrompt') }}</div>
      <p class="settings-hint">{{ t('settingsMcp.agentPromptHint') }}</p>
      <pre class="mcp-snippet">{{ agentPrompt || '—' }}</pre>
      <button
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="!agentPrompt"
        @click="copyText(agentPrompt)"
      >
        {{ t('settingsMcp.copyAgentPrompt') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.mcp-port-input {
  flex: 0 0 120px;
  min-width: 120px;
  width: 120px;
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
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.mcp-approval-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
}

.mcp-approval-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.mcp-approval-option:disabled {
  opacity: 0.6;
  cursor: default;
}

.mcp-approval-option.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.mcp-approval-title {
  font-size: 13px;
  font-weight: 600;
}

.mcp-approval-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.command-policy-details {
  margin-top: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  overflow: hidden;
}

.command-policy-details > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.command-policy-details > summary::-webkit-details-marker,
.command-policy-details > summary::marker {
  display: none;
}

.command-policy-details > summary::before {
  content: '›';
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  transition: transform 0.15s ease;
}

.command-policy-details[open] > summary::before {
  transform: rotate(90deg);
}

.policy-count {
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
  text-align: center;
}

.command-policy-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border-color);
}

.active-policy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 12px;
  padding: 9px 10px;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.active-policy strong {
  color: var(--text-primary);
  font-size: 12px;
}

.active-policy[data-tone='deny'] {
  border-color: color-mix(in srgb, var(--warning-color, #d98e04) 45%, var(--border-color));
  background: color-mix(in srgb, var(--warning-color, #d98e04) 8%, transparent);
}

.active-policy[data-tone='ask'] {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  background: var(--accent-bg);
}

.active-policy[data-tone='danger'] {
  border-color: color-mix(in srgb, var(--danger-color, #d94a4a) 45%, var(--border-color));
  background: color-mix(in srgb, var(--danger-color, #d94a4a) 8%, transparent);
}

.policy-intro {
  margin-top: 10px;
}

.policy-section {
  margin-top: 14px;
}

.policy-section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
}

.policy-section-title > span:last-child:not(:first-child) {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 400;
}

.policy-section .settings-hint {
  margin: 4px 0 7px;
}

.command-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.command-chip-list code,
.policy-rule code {
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 10px;
}

.command-chip-list code {
  padding: 3px 6px;
}

.command-chip-list.danger code {
  color: var(--danger-color, #d94a4a);
}

.policy-rule-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.policy-rule {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(220px, 1.2fr);
  gap: 8px;
  align-items: start;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.policy-rule code {
  padding: 4px 6px;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .policy-rule {
    grid-template-columns: 1fr;
    gap: 3px;
  }
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
